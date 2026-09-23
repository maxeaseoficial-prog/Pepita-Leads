import type { CompanyLead, SocialMatch } from "./types";
import { extractCnpjCandidates } from "./company-registry";

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
};

function norm(v?: string | null) {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function simpleSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = new Set(a.split(" "));
  const bb = new Set(b.split(" "));
  const intersect = [...aa].filter(x => bb.has(x)).length;
  return intersect / Math.max(aa.size, bb.size, 1);
}

export type WebsiteContacts = {
  instagram: SocialMatch | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  cnpj: string | null;
};

function formatBrazilPhone(value: string | null) {
  if (!value) return null;
  let digits=value.replace(/\D/g,"");
  if (digits.startsWith("55") && digits.length>=12) digits=digits.slice(2);
  if (digits.length===11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  if (digits.length===10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return value.trim()||null;
}

function firstWhatsappFromHtml(html:string) {
  const patterns=[
    /(?:wa\.me\/)(?:55)?(\d{10,11})/i,
    /(?:api\.)?whatsapp\.com\/send\?[^"'<>]*?phone=(?:%2B|\+)?(?:55)?(\d{10,11})/i,
    /(?:whatsapp:\/\/send\?[^"'<>]*?phone=)(?:%2B|\+)?(?:55)?(\d{10,11})/i
  ];
  for(const pattern of patterns) {
    const match=html.match(pattern);
    if(match?.[1]) return formatBrazilPhone(match[1]);
  }
  return null;
}

function firstPhoneFromHtml(html:string) {
  const tel=html.match(/href=["']tel:([^"'<>]+)["']/i)?.[1]||null;
  return formatBrazilPhone(tel);
}

function firstEmailFromHtml(html:string) {
  const match=html.match(/href=["']mailto:([^"'<>?]+)(?:\?[^"'<>]*)?["']/i);
  return match?.[1]?.trim().toLowerCase()||null;
}

export async function enrichPlace(company: CompanyLead) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const query = [
    company.tradeName || company.legalName,
    company.city,
    company.state
  ].filter(Boolean).join(" ");

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.googleMapsUri",
        "places.websiteUri",
        "places.nationalPhoneNumber"
      ].join(",")
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "pt-BR",
      regionCode: "BR",
      pageSize: 5
    }),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) return null;
  const body = await response.json() as { places?: Place[] };
  const candidates = body.places || [];
  const companyName = norm(company.tradeName || company.legalName);

  const ranked = candidates
    .map(place => {
      const nameScore = simpleSimilarity(companyName, norm(place.displayName?.text));
      const cityScore = company.city && norm(place.formattedAddress).includes(norm(company.city)) ? .2 : 0;
      return { score: nameScore * .8 + cityScore, place };
    })
    .sort((a,b) => b.score-a.score);

  if (!ranked.length || ranked[0].score < .52) return null;
  return ranked[0];
}

export async function contactsFromWebsite(website: string): Promise<WebsiteContacts> {
  const empty:WebsiteContacts={instagram:null,whatsapp:null,phone:null,email:null,cnpj:null};
  try {
    const url = new URL(website);
    if (!["http:","https:"].includes(url.protocol)) return empty;

    const response = await fetch(url, {
      headers: { "User-Agent": "PepitaBusinessEnrichment/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return empty;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return empty;

    const html = (await response.text()).slice(0,1_500_000);
    const instagramMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,64})\/?/i);

    return {
      instagram:instagramMatch?{
        url:`https://www.instagram.com/${instagramMatch[1]}/`,
        confidence:"CONFIRMED_FROM_WEBSITE_LINK",
        source:"OFFICIAL_WEBSITE"
      }:null,
      whatsapp:firstWhatsappFromHtml(html),
      phone:firstPhoneFromHtml(html),
      email:firstEmailFromHtml(html),
      cnpj:extractCnpjCandidates(html)[0]||null
    };
  } catch {
    return empty;
  }
}

export async function instagramFromWebsite(website: string): Promise<SocialMatch | null> {
  return (await contactsFromWebsite(website)).instagram;
}

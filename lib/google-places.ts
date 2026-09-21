import type { CompanyLead, SocialMatch } from "./types";

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

export async function instagramFromWebsite(website: string): Promise<SocialMatch | null> {
  try {
    const url = new URL(website);
    if (!["http:","https:"].includes(url.protocol)) return null;

    const response = await fetch(url, {
      headers: { "User-Agent": "PepitaBusinessEnrichment/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return null;
    const html = (await response.text()).slice(0,1_000_000);
    const match = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,64})\/?/i);
    if (!match) return null;
    return {
      url: `https://www.instagram.com/${match[1]}/`,
      confidence: "CONFIRMED_FROM_WEBSITE_LINK",
      source: "OFFICIAL_WEBSITE"
    };
  } catch {
    return null;
  }
}

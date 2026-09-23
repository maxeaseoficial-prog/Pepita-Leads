import type { CompanyLead, SearchPayload, SearchResponse, SocialMatch } from "./types";

const CACHE_TTL_MS=6*60*60*1000;
const MAX_RESULTS=20;
const DEFAULT_ENDPOINT="https://maps.mail.ru/osm/tools/overpass/api/interpreter";

type OsmTags=Record<string,string|undefined>;
type OsmElement={
  id:number;
  type:"node"|"way"|"relation";
  lat?:number;
  lon?:number;
  center?:{lat?:number;lon?:number};
  tags?:OsmTags;
};
type OsmResponse={elements?:OsmElement[];remark?:string};
type NominatimRow={
  place_id?:number;
  osm_id?:number;
  osm_type?:"node"|"way"|"relation";
  lat?:string;
  lon?:string;
  name?:string;
  display_name?:string;
  category?:string;
  type?:string;
  address?:Record<string,string|undefined>;
  extratags?:OsmTags;
};
type CachedSearch={expiresAt:number;value:SearchResponse};

const cache=new Map<string,CachedSearch>();

function clean(value?:string|null) {
  return (value||"").replace(/\s+/g," ").trim();
}

function normalize(value:string) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("pt-BR");
}

function qlString(value:string) {
  return `"${value.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"`;
}

function regexValue(value:string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g,"\\$&");
}

function selectorsForNiche(niche:string) {
  const value=normalize(niche);
  const includes=(...terms:string[])=>terms.some(term=>value.includes(term));

  if(includes("advog","juridic","escritorio de direito")) return ['["office"="lawyer"]'];
  if(includes("dentist","odontolog")) return ['["amenity"="dentist"]','["healthcare"="dentist"]'];
  if(includes("contabil","contador")) return ['["office"="accountant"]'];
  if(includes("imobiliar","corretor de imove")) return ['["office"="estate_agent"]'];
  if(includes("seguradora","seguro")) return ['["office"="insurance"]'];
  if(includes("academia","fitness")) return ['["leisure"="fitness_centre"]'];
  if(includes("restaurante")) return ['["amenity"="restaurant"]'];
  if(includes("cafeteria","cafe")) return ['["amenity"="cafe"]'];
  if(includes("farmacia","drogaria")) return ['["amenity"="pharmacy"]'];
  if(includes("veterinar")) return ['["amenity"="veterinary"]'];
  if(includes("supermercado","mercado")) return ['["shop"="supermarket"]'];
  if(includes("hotel","pousada")) return ['["tourism"="hotel"]','["tourism"="guest_house"]'];
  if(includes("salao de beleza","cabeleireir")) return ['["shop"="hairdresser"]','["shop"="beauty"]'];
  if(includes("clinica","medico","medica")) return ['["amenity"="clinic"]','["amenity"="doctors"]'];
  if(includes("escola","colegio")) return ['["amenity"="school"]'];
  if(includes("loja de carro","concessionaria","revenda de veiculo","venda de carro")) return ['["shop"="car"]'];

  const words=value.split(/[^a-z0-9]+/).filter(word=>word.length>=4).slice(0,3);
  if(!words.length) return [];
  return [`["name"~${qlString(words.map(regexValue).join("|"))},i]`];
}

function queryFor(input:SearchPayload,selectors:string[]) {
  const state=`BR-${input.state}`;
  const city=qlString(clean(input.city));
  const body=selectors.map(selector=>`nwr(area.city)${selector};`).join("\n");
  return [
    "[out:json][timeout:20];",
    `area["ISO3166-2"=${qlString(state)}]["boundary"="administrative"]["admin_level"="4"]->.state;`,
    `relation(area.state)["name"=${city}]["boundary"="administrative"]["admin_level"="8"]->.cityRel;`,
    ".cityRel map_to_area ->.city;",
    `(${body});`,
    "out center tags 60;"
  ].join("\n");
}

function formatPhone(value?:string) {
  let digits=clean(value).replace(/\D/g,"");
  if(digits.startsWith("55")&&digits.length>=12) digits=digits.slice(2);
  if(digits.startsWith("0")&&digits.length>=11) digits=digits.slice(1);
  if(digits.length===11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  if(digits.length===10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return clean(value)||null;
}

function addressFromTags(tags:OsmTags) {
  const street=clean(tags["addr:street"]);
  const number=clean(tags["addr:housenumber"]);
  const neighborhood=clean(tags["addr:suburb"]||tags["addr:neighbourhood"]);
  const parts=[street&&number?`${street}, ${number}`:street||number,neighborhood].filter(Boolean);
  return parts.join(" — ")||null;
}

function contact(tags:OsmTags,key:string) {
  return clean(tags[`contact:${key}`]||tags[key])||null;
}

function instagramFromWebsite(website:string|null):SocialMatch|null {
  if(!website) return null;
  try {
    const parsed=new URL(website);
    if(!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
    return {url:website,confidence:"PUBLISHED_BY_BUSINESS",source:"OPENSTREETMAP"};
  } catch {
    return null;
  }
}

function candidateCnpj(tags:OsmTags) {
  for(const value of [tags["ref:cnpj"],tags.cnpj,tags["contact:cnpj"]]) {
    const digits=clean(value).replace(/\D/g,"");
    if(digits.length===14) return digits;
  }
  return null;
}

function score(tags:OsmTags,address:string|null) {
  const phone=contact(tags,"phone")||contact(tags,"mobile");
  const website=contact(tags,"website");
  const email=contact(tags,"email");
  const value=40+(phone?20:0)+(website?15:0)+(email?10:0)+(address?10:0);
  return {
    score:value,
    level:(value>=75?"HIGH":value>=55?"MEDIUM":"LOW") as "HIGH"|"MEDIUM"|"LOW",
    reasons:[
      phone?"telefone público disponível":"telefone não localizado",
      website?"site publicado":"site não localizado",
      address?"endereço público disponível":"endereço não localizado"
    ]
  };
}

function toLead(element:OsmElement,input:SearchPayload):CompanyLead|null {
  const tags=element.tags||{};
  const name=clean(tags.name||tags.brand||tags.operator);
  if(!name) return null;

  const address=addressFromTags(tags);
  const phone=formatPhone(contact(tags,"phone")||contact(tags,"mobile")||undefined);
  const website=contact(tags,"website");
  const email=contact(tags,"email");
  const lat=element.lat??element.center?.lat;
  const lon=element.lon??element.center?.lon;
  const mapsUrl=lat!=null&&lon!=null
    ?`https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=18/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`
    :`https://www.openstreetmap.org/${element.type}/${element.id}`;

  return {
    cnpj:"",
    cnpjFormatted:"Não localizado",
    cnpjCandidate:candidateCnpj(tags),
    legalName:name,
    tradeName:name,
    category:clean(tags.office||tags.amenity||tags.shop||tags.healthcare||tags.tourism)||input.niche,
    cnae:null,
    statusCode:null,
    openingDate:null,
    ageYears:null,
    companySizeCode:null,
    companySize:"Não informado",
    capitalSocialCents:null,
    matrixBranch:"Não informado",
    city:input.city,
    state:input.state,
    address,
    postalCode:clean(tags["addr:postcode"])||null,
    phone,
    whatsapp:formatPhone(contact(tags,"whatsapp")||undefined),
    ownerPhone:null,
    ownerWhatsapp:null,
    email,
    website,
    mapsUrl,
    social:{instagram:instagramFromWebsite(website)},
    potential:score(tags,address)
  };
}

function nominatimElements(rows:NominatimRow[]) {
  return rows.map((row,index)=>{
    const address=row.address||{};
    const tags:OsmTags={
      ...(row.extratags||{}),
      name:clean(row.name||row.display_name?.split(",")[0]),
      "addr:street":clean(address.road||address.pedestrian),
      "addr:housenumber":clean(address.house_number),
      "addr:suburb":clean(address.suburb||address.neighbourhood||address.city_district),
      "addr:postcode":clean(address.postcode)
    };
    if(row.category&&row.type) tags[row.category]=row.type;
    return {
      id:Number(row.osm_id||row.place_id||index),
      type:row.osm_type||"node",
      lat:Number(row.lat),
      lon:Number(row.lon),
      tags
    } satisfies OsmElement;
  });
}

async function searchNominatim(input:SearchPayload) {
  const url=new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format","jsonv2");
  url.searchParams.set("q",`${input.niche}, ${input.city}, ${input.state}, Brasil`);
  url.searchParams.set("limit",String(MAX_RESULTS));
  url.searchParams.set("extratags","1");
  url.searchParams.set("addressdetails","1");

  const response=await fetch(url,{
    headers:{
      "User-Agent":"PepitaLeads/1.0 (public-business-search)",
      "Accept-Language":"pt-BR,pt;q=0.9"
    },
    signal:AbortSignal.timeout(12_000),
    cache:"no-store"
  });
  if(!response.ok) throw new Error(`NOMINATIM_HTTP_${response.status}`);
  return nominatimElements(await response.json() as NominatimRow[]);
}

export async function searchOpenStreetMap(input:SearchPayload):Promise<SearchResponse> {
  const selectors=selectorsForNiche(input.niche);
  const requested=Math.min(Math.max(1,input.quantity),MAX_RESULTS);
  const empty=():SearchResponse=>({
    input:{...input,quantity:requested},
    requested,
    returned:0,
    partial:true,
    dataset:{mode:"OPENSTREETMAP",reference:"© OpenStreetMap contributors — estabelecimentos públicos"},
    results:[]
  });
  if(!selectors.length||!/^[A-Z]{2}$/.test(input.state)||!clean(input.city)) return empty();

  const key=JSON.stringify({niche:normalize(input.niche),city:normalize(input.city),state:input.state,requested});
  const cached=cache.get(key);
  if(cached&&cached.expiresAt>Date.now()) return structuredClone(cached.value);

  let elements=await searchNominatim(input).catch(()=>[] as OsmElement[]);
  if(!elements.length) {
    const endpoint=process.env.OPENSTREETMAP_OVERPASS_URL||DEFAULT_ENDPOINT;
    const body=new URLSearchParams({data:queryFor(input,selectors)});
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent":"PepitaLeads/1.0 (public-business-search)"
      },
      body,
      signal:AbortSignal.timeout(15_000),
      cache:"no-store"
    });
    if(!response.ok) throw new Error(`OPENSTREETMAP_HTTP_${response.status}`);
    const payload=await response.json() as OsmResponse;
    elements=payload.elements||[];
  }

  const seen=new Set<string>();
  const candidates=elements
    .map(element=>toLead(element,input))
    .filter((lead):lead is CompanyLead=>Boolean(lead))
    .filter(lead=>{
      const signature=normalize(`${lead.tradeName}|${lead.address||""}`);
      if(seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((a,b)=>
      Number(Boolean(b.phone))-Number(Boolean(a.phone))
      ||Number(Boolean(b.email))-Number(Boolean(a.email))
      ||Number(Boolean(b.website))-Number(Boolean(a.website))
      ||a.legalName.localeCompare(b.legalName,"pt-BR")
    );

  const results=candidates.slice(0,requested);
  const value:SearchResponse={
    input:{...input,quantity:requested},
    requested,
    returned:results.length,
    partial:results.length<requested,
    dataset:{mode:"OPENSTREETMAP",reference:"© OpenStreetMap contributors — estabelecimentos públicos"},
    results
  };
  cache.set(key,{expiresAt:Date.now()+CACHE_TTL_MS,value});
  return structuredClone(value);
}

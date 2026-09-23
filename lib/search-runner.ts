import { getHealth } from "./health";
import { searchCompanies } from "./search";
import { searchGoogleMaps } from "./google-maps-browser";
import { enrichMapResultsFromRfb } from "./rfb-enrichment";
import type { SearchPayload, SearchResponse } from "./types";

function objectFromUnknown(value:unknown):Record<string,unknown> {
  if(value&&typeof value==="object"&&!Array.isArray(value)) {
    return value as Record<string,unknown>;
  }

  if(typeof value==="string") {
    try {
      const parsed=JSON.parse(value) as unknown;
      if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)) {
        return parsed as Record<string,unknown>;
      }
    } catch {}
  }

  return {};
}

export function normalizeSearchPayload(value:unknown):SearchPayload {
  const raw=objectFromUnknown(value);

  const quantity=Math.max(1,Math.min(60,Number(raw.quantity)||10));
  const minCapital=Math.max(0,Number(raw.minCapital)||0);
  const minAgeYears=Math.max(0,Number(raw.minAgeYears)||0);
  const minPotential=
    raw.minPotential==="HIGH"||raw.minPotential==="MEDIUM_PLUS"
      ? raw.minPotential
      : "ALL";

  const companySizes=Array.isArray(raw.companySizes)
    ? raw.companySizes.filter((item):item is "MICRO"|"SMALL"|"OTHER"=>
        item==="MICRO"||item==="SMALL"||item==="OTHER"
      )
    : [];

  return {
    niche:String(raw.niche||"").trim(),
    city:String(raw.city||"").trim(),
    state:String(raw.state||"").trim().toUpperCase(),
    quantity,
    companySizes,
    minCapital,
    minAgeYears,
    minPotential,
    activeOnly:raw.activeOnly!==false,
    hasPhone:raw.hasPhone!==false,
    hasEmail:raw.hasEmail!==false,
    matrixOnly:raw.matrixOnly===true,
    onlyWithoutSite:raw.onlyWithoutSite===true,
    findInstagram:raw.findInstagram!==false
  };
}

export async function runCompanySearch(rawPayload:unknown):Promise<SearchResponse> {
  const payload=normalizeSearchPayload(rawPayload);

  if(!payload.niche) throw new Error("Informe o nicho.");
  if(!payload.city) throw new Error("Informe a cidade.");

  const useRfb=process.env.SEARCH_PROVIDER==="RFB";
  const result=useRfb?await searchCompanies(payload):await searchGoogleMaps(payload);

  if(useRfb) {
    const health=await getHealth();
    result.dataset.reference=health.datasetReference||null;
  } else {
    const enriched=await enrichMapResultsFromRfb(result.results,payload);
    result.results=enriched.slice(0,result.requested);
    result.returned=result.results.length;
    result.partial=result.returned<result.requested;
    result.dataset.mode="GOOGLE_MAPS_RFB_ENRICHED";
    result.dataset.reference="Google Maps + base pública CNPJ/RFB da Pepita";
  }

  return result;
}

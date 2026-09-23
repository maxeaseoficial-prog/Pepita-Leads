import { getHealth } from "./health";
import { searchCompanies } from "./search";
import { searchGoogleMaps } from "./google-maps-browser";
import { enrichMapResultsFromRfb } from "./rfb-enrichment";
import type { SearchPayload, SearchResponse } from "./types";

export async function runCompanySearch(payload:SearchPayload):Promise<SearchResponse> {
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

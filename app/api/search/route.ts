import { NextRequest, NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
import { searchCompanies } from "@/lib/search";
import { searchGoogleMaps } from "@/lib/google-maps-browser";
import type { SearchPayload } from "@/lib/types";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as SearchPayload;
    const useRfb=process.env.SEARCH_PROVIDER==="RFB";
    const result=useRfb?await searchCompanies(payload):await searchGoogleMaps(payload);
    if(useRfb) {
      const health=await getHealth();
      result.dataset.reference=health.datasetReference||null;
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: "SEARCH_FAILED",
      message: error instanceof Error ? error.message : "Falha na busca."
    }, { status: 502 });
  }
}

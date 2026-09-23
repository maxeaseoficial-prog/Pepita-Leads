import { NextRequest, NextResponse } from "next/server";
import { runCompanySearch } from "@/lib/search-runner";
import type { SearchPayload } from "@/lib/types";

export const maxDuration=300;
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest) {
  try {
    const payload=await request.json() as SearchPayload;
    return NextResponse.json(await runCompanySearch(payload));
  } catch(error) {
    return NextResponse.json({
      error:"SEARCH_FAILED",
      message:error instanceof Error?error.message:"Falha na busca."
    },{status:502});
  }
}

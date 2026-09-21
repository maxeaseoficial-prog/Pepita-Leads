import { NextRequest, NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
import { searchCompanies } from "@/lib/search";
import type { SearchPayload } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const health = await getHealth();
  if (!health.ready) {
    return NextResponse.json({
      error: "DATASET_NOT_READY",
      message: "A base real da Receita ainda não está pronta."
    }, { status: 503 });
  }

  try {
    const payload = await request.json() as SearchPayload;
    const result = await searchCompanies(payload);
    result.dataset.reference = health.datasetReference || null;
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: "SEARCH_FAILED",
      message: error instanceof Error ? error.message : "Falha na busca."
    }, { status: 400 });
  }
}

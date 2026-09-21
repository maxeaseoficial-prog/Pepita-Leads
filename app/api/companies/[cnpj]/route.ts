import { NextRequest, NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
import { getCompanyDetail } from "@/lib/company";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cnpj: string }> }
) {
  const health = await getHealth();
  if (!health.ready) {
    return NextResponse.json({
      error: "DATASET_NOT_READY",
      message: "A base real da Receita ainda não está pronta."
    }, { status: 503 });
  }

  const { cnpj } = await params;
  const detail = await getCompanyDetail(cnpj);
  if (!detail) {
    return NextResponse.json({ error:"NOT_FOUND" }, { status:404 });
  }
  return NextResponse.json(detail);
}

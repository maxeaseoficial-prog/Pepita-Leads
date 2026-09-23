import { NextRequest, NextResponse } from "next/server";
import { getCompanyDetail } from "@/lib/company";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cnpj: string }> }
) {
  const { cnpj } = await params;
  const detail = await getCompanyDetail(cnpj);
  if (!detail) {
    return NextResponse.json({ error:"NOT_FOUND" }, { status:404 });
  }
  return NextResponse.json(detail);
}

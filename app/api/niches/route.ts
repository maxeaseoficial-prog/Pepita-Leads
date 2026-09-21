import { NextRequest, NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
import { getSql } from "@/lib/db";
import { normalizeText } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const health = await getHealth();
  if (!health.ready) {
    return NextResponse.json([], { status: 503 });
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  const sql = getSql();
  const rows = await sql.query(
    "SELECT code,label FROM cnaes WHERE normalized_label LIKE $1 ORDER BY label LIMIT 20",
    [`%${normalizeText(q)}%`]
  );
  return NextResponse.json(rows);
}

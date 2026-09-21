import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health, { status: health.ok ? 200 : 503 });
}

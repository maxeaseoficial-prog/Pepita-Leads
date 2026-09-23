import { NextResponse } from "next/server";
import { loadPlanSettings } from "@/lib/plan-settings";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET() {
  const plans=await loadPlanSettings();
  return NextResponse.json({
    plans:plans.map(({stripePriceId:_,...plan})=>plan)
  });
}
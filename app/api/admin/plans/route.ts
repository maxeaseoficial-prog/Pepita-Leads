import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { loadPlanSettings, savePlanSettings, type ManagedPlanSetting } from "@/lib/plan-settings";
import { stripeConfig } from "@/lib/stripe-billing";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest) {
  try {
    await requireAdmin(request);
    const plans=await loadPlanSettings();
    const stripe=stripeConfig();

    return NextResponse.json({
      plans,
      stripe:{
        secretConfigured:Boolean(stripe.secretKey),
        webhookConfigured:Boolean(stripe.webhookSecret)
      }
    });
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao carregar planos.";
    const status=
      message==="ADMIN_AUTH_REQUIRED"?401:
      message==="ADMIN_FORBIDDEN"?403:500;

    return NextResponse.json({error:message,message},{status});
  }
}

export async function PUT(request:NextRequest) {
  try {
    await requireAdmin(request);
    const body=await request.json() as {plans?:ManagedPlanSetting[]};

    if(!Array.isArray(body.plans)||body.plans.length!==3) {
      return NextResponse.json({error:"INVALID_PLANS"},{status:400});
    }

    await savePlanSettings(body.plans);
    return NextResponse.json({ok:true,plans:await loadPlanSettings()});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao salvar planos.";
    const status=
      message==="ADMIN_AUTH_REQUIRED"?401:
      message==="ADMIN_FORBIDDEN"?403:500;

    return NextResponse.json({error:message,message},{status});
  }
}
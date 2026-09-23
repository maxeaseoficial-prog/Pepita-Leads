import { NextRequest, NextResponse } from "next/server";
import { billingForUser } from "@/lib/billing";
import { stripeCheckoutReady } from "@/lib/stripe-billing";
import { workspaceForRequest, GUEST_WORKSPACE } from "@/lib/supabase/server-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const ACTIVE_STATUSES=new Set(["active","trialing"]);

export async function GET(request:NextRequest) {
  try {
    const userId=await workspaceForRequest(request);
    if(userId===GUEST_WORKSPACE) {
      return NextResponse.json({configured:stripeCheckoutReady(),plan:"free",status:"inactive",cancelAtPeriodEnd:false});
    }

    const billing=await billingForUser(userId).catch(()=>null);
    const active=Boolean(billing?.plan&&ACTIVE_STATUSES.has(billing.status));
    return NextResponse.json({
      configured:stripeCheckoutReady(),
      plan:active?billing?.plan:"free",
      status:billing?.status||"inactive",
      cancelAtPeriodEnd:Boolean(billing?.cancelAtPeriodEnd),
      currentPeriodEnd:billing?.currentPeriodEnd||null
    });
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao consultar assinatura.";
    return NextResponse.json({error:"BILLING_STATUS_FAILED",message},{status:401});
  }
}

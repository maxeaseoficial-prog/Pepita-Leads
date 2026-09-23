import { NextRequest, NextResponse } from "next/server";
import { billingForUser } from "@/lib/billing";
import { stripePost } from "@/lib/stripe-billing";
import { workspaceForRequest, GUEST_WORKSPACE } from "@/lib/supabase/server-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest) {
  try {
    const userId=await workspaceForRequest(request);
    if(userId===GUEST_WORKSPACE) return NextResponse.json({error:"AUTH_REQUIRED"},{status:401});

    const billing=await billingForUser(userId);
    if(!billing?.stripeCustomerId) return NextResponse.json({error:"NO_STRIPE_CUSTOMER"},{status:409});

    const params=new URLSearchParams({
      customer:billing.stripeCustomerId,
      return_url:`${request.nextUrl.origin}/#settings`
    });
    const session=await stripePost<{url?:string|null}>("/billing_portal/sessions",params);
    if(!session.url) return NextResponse.json({error:"PORTAL_URL_MISSING"},{status:502});
    return NextResponse.json({url:session.url});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao abrir portal da assinatura.";
    return NextResponse.json({error:"PORTAL_FAILED",message},{status:502});
  }
}

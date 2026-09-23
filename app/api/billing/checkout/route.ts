import { NextRequest, NextResponse } from "next/server";
import { workspaceForRequest, GUEST_WORKSPACE } from "@/lib/supabase/server-auth";
import { stripeCheckoutReady, stripePost, stripePriceForPlan, type StripePlan } from "@/lib/stripe-billing";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest) {
  try {
    const userId=await workspaceForRequest(request);
    if(userId===GUEST_WORKSPACE) return NextResponse.json({error:"AUTH_REQUIRED"},{status:401});
    if(!stripeCheckoutReady()) return NextResponse.json({error:"STRIPE_NOT_CONFIGURED"},{status:503});

    const body=await request.json().catch(()=>({})) as {plan?:string};
    const plan:StripePlan|null=body.plan==="basic"||body.plan==="unlimited"?body.plan:null;
    if(!plan) return NextResponse.json({error:"INVALID_PLAN"},{status:400});

    const priceId=stripePriceForPlan(plan);
    const origin=request.nextUrl.origin;
    const params=new URLSearchParams({
      mode:"subscription",
      success_url:`${origin}/#plans`,
      cancel_url:`${origin}/#plans`,
      client_reference_id:userId,
      "line_items[0][price]":priceId,
      "line_items[0][quantity]":"1",
      "metadata[user_id]":userId,
      "metadata[plan]":plan,
      "subscription_data[metadata][user_id]":userId,
      "subscription_data[metadata][plan]":plan,
      allow_promotion_codes:"true"
    });

    const session=await stripePost<{id:string;url?:string|null}>("/checkout/sessions",params);
    if(!session.url) return NextResponse.json({error:"CHECKOUT_URL_MISSING"},{status:502});
    return NextResponse.json({id:session.id,url:session.url});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao iniciar checkout.";
    const status=/INVALID_SESSION|AUTH_NOT_CONFIGURED/.test(message)?401:502;
    return NextResponse.json({error:"CHECKOUT_FAILED",message},{status});
  }
}

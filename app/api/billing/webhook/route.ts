import { NextRequest, NextResponse } from "next/server";
import { upsertBilling } from "@/lib/billing";
import { setUserPlanMetadata } from "@/lib/admin-auth";
import { planFromStripePrice, verifyStripeWebhook, type StripePlan } from "@/lib/stripe-billing";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type StripeObject=Record<string,unknown>;
type StripeEvent={type?:string;data?:{object?:StripeObject}};

function objectId(value:unknown) {
  if(typeof value==="string") return value;
  if(value&&typeof value==="object"&&"id" in value) {
    return String((value as {id:unknown}).id);
  }
  return null;
}

function metadataOf(value:unknown) {
  return value&&typeof value==="object"&&!Array.isArray(value)
    ? value as Record<string,unknown>
    : {};
}

function subscriptionPriceId(object:StripeObject) {
  const items=object.items;
  if(!items||typeof items!=="object") return null;

  const data=(items as {data?:unknown}).data;
  if(!Array.isArray(data)||!data[0]||typeof data[0]!=="object") return null;

  const price=(data[0] as {price?:unknown}).price;
  return objectId(price);
}

async function planFromObject(object:StripeObject):Promise<StripePlan|null> {
  const metadata=metadataOf(object.metadata);
  const metaPlan=metadata.plan;

  if(metaPlan==="basic"||metaPlan==="unlimited") return metaPlan;
  return planFromStripePrice(subscriptionPriceId(object));
}

function userIdFromObject(object:StripeObject) {
  const metadata=metadataOf(object.metadata);

  return typeof metadata.user_id==="string"
    ? metadata.user_id
    : typeof object.client_reference_id==="string"
      ? object.client_reference_id
      : null;
}

function periodEnd(object:StripeObject) {
  const raw=Number(object.current_period_end);
  return Number.isFinite(raw)&&raw>0
    ? new Date(raw*1000).toISOString()
    : null;
}

export async function POST(request:NextRequest) {
  const raw=await request.text();

  if(!verifyStripeWebhook(raw,request.headers.get("stripe-signature"))) {
    return NextResponse.json({error:"INVALID_SIGNATURE"},{status:400});
  }

  let event:StripeEvent;
  try {
    event=JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({error:"INVALID_JSON"},{status:400});
  }

  const object=event.data?.object||{};
  const type=event.type||"";

  try {
    if(type==="checkout.session.completed") {
      const userId=userIdFromObject(object);
      const plan=await planFromObject(object);

      if(userId&&plan) {
        await upsertBilling({
          userId,
          stripeCustomerId:objectId(object.customer),
          stripeSubscriptionId:objectId(object.subscription),
          plan,
          status:"checkout_completed",
          currentPeriodEnd:null,
          cancelAtPeriodEnd:false
        });

        await setUserPlanMetadata(userId,plan).catch(error=>{
          console.error("STRIPE_PLAN_METADATA_SYNC_ERROR",error);
        });
      }
    }

    if(
      type==="customer.subscription.created"||
      type==="customer.subscription.updated"||
      type==="customer.subscription.deleted"
    ) {
      const userId=userIdFromObject(object);
      const plan=await planFromObject(object);
      const deleted=type==="customer.subscription.deleted";

      if(userId) {
        await upsertBilling({
          userId,
          stripeCustomerId:objectId(object.customer),
          stripeSubscriptionId:objectId(object.id),
          plan,
          status:deleted?"canceled":String(object.status||"inactive"),
          currentPeriodEnd:periodEnd(object),
          cancelAtPeriodEnd:Boolean(object.cancel_at_period_end)
        });

        if(deleted) {
          await setUserPlanMetadata(userId,"free").catch(error=>{
            console.error("STRIPE_PLAN_METADATA_SYNC_ERROR",error);
          });
        } else if(plan&&["active","trialing"].includes(String(object.status||""))) {
          await setUserPlanMetadata(userId,plan).catch(error=>{
            console.error("STRIPE_PLAN_METADATA_SYNC_ERROR",error);
          });
        }
      }
    }

    return NextResponse.json({received:true});
  } catch(error) {
    console.error("STRIPE_WEBHOOK_ERROR",error);
    return NextResponse.json({error:"WEBHOOK_PROCESSING_FAILED"},{status:500});
  }
}
import { createHmac, timingSafeEqual } from "crypto";

export type StripePlan="basic"|"unlimited";

export function stripeConfig() {
  return {
    secretKey:process.env.STRIPE_SECRET_KEY||"",
    webhookSecret:process.env.STRIPE_WEBHOOK_SECRET||"",
    priceBasic:process.env.STRIPE_PRICE_BASIC||"",
    priceUnlimited:process.env.STRIPE_PRICE_UNLIMITED||""
  };
}

export function stripeCheckoutReady() {
  const config=stripeConfig();
  return Boolean(config.secretKey&&config.priceBasic&&config.priceUnlimited);
}

export function stripePriceForPlan(plan:StripePlan) {
  const config=stripeConfig();
  return plan==="basic"?config.priceBasic:config.priceUnlimited;
}

export function planFromStripePrice(priceId:string|null|undefined):StripePlan|null {
  if(!priceId) return null;
  const config=stripeConfig();
  if(config.priceBasic&&priceId===config.priceBasic) return "basic";
  if(config.priceUnlimited&&priceId===config.priceUnlimited) return "unlimited";
  return null;
}

export async function stripePost<T=Record<string,unknown>>(path:string,params:URLSearchParams):Promise<T> {
  const {secretKey}=stripeConfig();
  if(!secretKey) throw new Error("STRIPE_NOT_CONFIGURED");
  const response=await fetch(`https://api.stripe.com/v1${path}`,{
    method:"POST",
    headers:{
      Authorization:`Bearer ${secretKey}`,
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body:params.toString(),
    cache:"no-store"
  });
  const body=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok) {
    const nested=body.error&&typeof body.error==="object"?body.error as Record<string,unknown>:null;
    const message=typeof nested?.message==="string"?nested.message:"Falha ao comunicar com a Stripe.";
    throw new Error(message);
  }
  return body as T;
}

function secureEqual(left:string,right:string) {
  const a=Buffer.from(left,"utf8");
  const b=Buffer.from(right,"utf8");
  return a.length===b.length&&timingSafeEqual(a,b);
}

export function verifyStripeWebhook(payload:string,signature:string|null) {
  const {webhookSecret}=stripeConfig();
  if(!webhookSecret||!signature) return false;

  const parts=signature.split(",").map(part=>part.trim());
  const timestamp=parts.find(part=>part.startsWith("t="))?.slice(2)||"";
  const signatures=parts.filter(part=>part.startsWith("v1=")).map(part=>part.slice(3));
  if(!timestamp||!signatures.length) return false;

  const seconds=Number(timestamp);
  if(!Number.isFinite(seconds)||Math.abs(Date.now()/1000-seconds)>300) return false;

  const digest=createHmac("sha256",webhookSecret).update(`${timestamp}.${payload}`,"utf8").digest("hex");
  return signatures.some(candidate=>secureEqual(candidate,digest));
}

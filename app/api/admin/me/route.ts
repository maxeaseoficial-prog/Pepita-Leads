import { NextRequest, NextResponse } from "next/server";
import { adminCount, adminServiceConfigured, authUserForRequest, isAdminUser } from "@/lib/admin-auth";
import { stripeConfig } from "@/lib/stripe-billing";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest) {
  const user=await authUserForRequest(request);
  const totalAdmins=await adminCount().catch(()=>0);
  const admin=user?await isAdminUser(user.id).catch(()=>false):false;
  const stripe=stripeConfig();

  return NextResponse.json({
    authenticated:Boolean(user),
    admin,
    bootstrapAvailable:totalAdmins===0,
    adminSetupConfigured:Boolean(process.env.ADMIN_SECRET),
    serviceRoleConfigured:adminServiceConfigured(),
    stripeSecretConfigured:Boolean(stripe.secretKey),
    stripeWebhookConfigured:Boolean(stripe.webhookSecret),
    user:user?{id:user.id,email:user.email||""}:null
  });
}
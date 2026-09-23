import { getSql } from "./db";
import type { StripePlan } from "./stripe-billing";

export type BillingRecord={
  userId:string;
  stripeCustomerId:string|null;
  stripeSubscriptionId:string|null;
  plan:StripePlan|null;
  status:string;
  currentPeriodEnd:string|null;
  cancelAtPeriodEnd:boolean;
};

type Row=Record<string,unknown>;

function mapBilling(row:Row):BillingRecord {
  return {
    userId:String(row.user_id),
    stripeCustomerId:row.stripe_customer_id?String(row.stripe_customer_id):null,
    stripeSubscriptionId:row.stripe_subscription_id?String(row.stripe_subscription_id):null,
    plan:row.plan==="basic"||row.plan==="unlimited"?row.plan:null,
    status:String(row.status||"inactive"),
    currentPeriodEnd:row.current_period_end?String(row.current_period_end):null,
    cancelAtPeriodEnd:Boolean(row.cancel_at_period_end)
  };
}

export async function billingForUser(userId:string):Promise<BillingRecord|null> {
  const sql=getSql();
  const rows=await sql.query(`
    select user_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,cancel_at_period_end
    from billing_subscriptions
    where user_id=$1
    limit 1
  `,[userId]) as unknown as Row[];
  return rows[0]?mapBilling(rows[0]):null;
}

export async function upsertBilling(input:BillingRecord) {
  const sql=getSql();
  await sql.query(`
    insert into billing_subscriptions(
      user_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,cancel_at_period_end,updated_at
    ) values($1,$2,$3,$4,$5,$6,$7,now())
    on conflict(user_id) do update set
      stripe_customer_id=coalesce(excluded.stripe_customer_id,billing_subscriptions.stripe_customer_id),
      stripe_subscription_id=coalesce(excluded.stripe_subscription_id,billing_subscriptions.stripe_subscription_id),
      plan=coalesce(excluded.plan,billing_subscriptions.plan),
      status=excluded.status,
      current_period_end=coalesce(excluded.current_period_end,billing_subscriptions.current_period_end),
      cancel_at_period_end=excluded.cancel_at_period_end,
      updated_at=now()
  `,[
    input.userId,input.stripeCustomerId,input.stripeSubscriptionId,input.plan,input.status,input.currentPeriodEnd,input.cancelAtPeriodEnd
  ]);
}

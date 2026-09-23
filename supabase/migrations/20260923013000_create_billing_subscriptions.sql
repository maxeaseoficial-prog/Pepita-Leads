create table if not exists billing_subscriptions (
  user_id text primary key,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan text check (plan in ('basic','unlimited')),
  status text not null default 'inactive',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_stripe_customer
  on billing_subscriptions(stripe_customer_id);

create index if not exists idx_billing_stripe_subscription
  on billing_subscriptions(stripe_subscription_id);

alter table billing_subscriptions enable row level security;
revoke all on table billing_subscriptions from anon, authenticated;

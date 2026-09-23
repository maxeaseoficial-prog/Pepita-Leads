create table if not exists admin_users (
  user_id text primary key,
  email text,
  role text not null default 'admin' check (role in ('owner','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists plan_settings (
  plan_id text primary key check (plan_id in ('free','basic','unlimited')),
  display_name text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  search_limit integer,
  results_per_search integer not null default 20,
  result_limit integer,
  is_popular boolean not null default false,
  stripe_price_id text,
  updated_at timestamptz not null default now()
);

insert into plan_settings(plan_id,display_name,price_cents,search_limit,results_per_search,result_limit,is_popular)
values
  ('free','Grátis',0,3,20,60,false),
  ('basic','Basic',2990,30,20,600,true),
  ('unlimited','Unlimited',9990,null,20,null,false)
on conflict(plan_id) do nothing;

alter table admin_users enable row level security;
alter table plan_settings enable row level security;

revoke all on table admin_users,plan_settings from anon,authenticated;
create table if not exists public.company_registry_cache (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  legal_name text not null,
  trade_name text,
  status text,
  city text,
  state text,
  phone text,
  email text,
  opening_date date,
  cnae text,
  category text,
  company_size text,
  capital_social_cents bigint,
  partners jsonb not null default '[]'::jsonb,
  source text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.company_registry_matches (
  search_key text primary key,
  cnpj text not null references public.company_registry_cache(cnpj) on delete cascade,
  confidence numeric(5,4) not null default 0,
  source text not null,
  updated_at timestamptz not null default now()
);

create index if not exists company_registry_cache_name_idx
  on public.company_registry_cache(lower(coalesce(trade_name,legal_name)));

create index if not exists company_registry_cache_state_city_idx
  on public.company_registry_cache(state,city);

alter table public.company_registry_cache enable row level security;
alter table public.company_registry_matches enable row level security;

grant select,insert,update,delete on table
  public.company_registry_cache,
  public.company_registry_matches
to pepita_app;

drop policy if exists "Pepita backend manages company registry cache" on public.company_registry_cache;
create policy "Pepita backend manages company registry cache"
on public.company_registry_cache
for all to pepita_app
using (true) with check (true);

drop policy if exists "Pepita backend manages company registry matches" on public.company_registry_matches;
create policy "Pepita backend manages company registry matches"
on public.company_registry_matches
for all to pepita_app
using (true) with check (true);

create table if not exists public.search_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  query_text text not null default '',
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists search_jobs_owner_updated_idx
  on public.search_jobs(owner_key, updated_at desc);

create index if not exists search_jobs_active_idx
  on public.search_jobs(owner_key, status, updated_at desc)
  where acknowledged_at is null;

alter table public.search_jobs enable row level security;

grant select, insert, update, delete on table public.search_jobs to pepita_app;

drop policy if exists "Pepita backend manages search jobs" on public.search_jobs;
create policy "Pepita backend manages search jobs"
on public.search_jobs
for all
to pepita_app
using (true)
with check (true);

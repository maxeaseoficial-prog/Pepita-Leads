create or replace function public.pepita_user_effective_plan(p_user_id uuid)
returns text
language sql
security definer
set search_path = pg_catalog, auth, public
as $$
  select case
    when lower(coalesce(u.raw_app_meta_data->>'pepita_plan',u.raw_app_meta_data->>'plan','free')) in ('basic','unlimited')
      then lower(coalesce(u.raw_app_meta_data->>'pepita_plan',u.raw_app_meta_data->>'plan','free'))
    else 'free'
  end
  from auth.users u
  where u.id=p_user_id;
$$;

revoke all on function public.pepita_user_effective_plan(uuid) from public, anon, authenticated;
grant execute on function public.pepita_user_effective_plan(uuid) to pepita_app;

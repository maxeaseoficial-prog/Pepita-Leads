create or replace function public.pepita_admin_list_users()
returns table (
  id text,
  email text,
  user_meta jsonb,
  app_meta jsonb,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, auth, public
as $$
  select
    u.id::text,
    coalesce(u.email,''),
    coalesce(u.raw_user_meta_data,'{}'::jsonb),
    coalesce(u.raw_app_meta_data,'{}'::jsonb),
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at
  from auth.users u
  order by u.created_at desc
  limit 1000;
$$;

revoke all on function public.pepita_admin_list_users() from public, anon, authenticated;
grant execute on function public.pepita_admin_list_users() to pepita_app;

create or replace function public.pepita_admin_set_user_plan(p_user_id uuid, p_plan text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, auth, public
as $$
begin
  if p_plan not in ('free','basic','unlimited') then
    raise exception 'INVALID_PLAN';
  end if;

  update auth.users
  set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('pepita_plan',p_plan),
      updated_at=now()
  where id=p_user_id;

  return found;
end;
$$;

revoke all on function public.pepita_admin_set_user_plan(uuid,text) from public, anon, authenticated;
grant execute on function public.pepita_admin_set_user_plan(uuid,text) to pepita_app;

alter table public.plan_settings
  add column if not exists description text;

update public.plan_settings
set description=case plan_id
  when 'free' then 'Experimente a Pepita e descubra o poder da prospecção inteligente.'
  when 'basic' then 'Para quem está começando a prospectar todos os meses.'
  when 'unlimited' then 'Para quem usa prospecção como parte da operação.'
end
where description is null or btrim(description)='';

alter table public.plan_settings
  alter column description set not null;

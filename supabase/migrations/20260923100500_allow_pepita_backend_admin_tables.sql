grant select, insert, update, delete on table
  public.admin_users,
  public.plan_settings,
  public.billing_subscriptions
to pepita_app;

drop policy if exists "Pepita backend manages admin users" on public.admin_users;
create policy "Pepita backend manages admin users"
on public.admin_users
for all
to pepita_app
using (true)
with check (true);

drop policy if exists "Pepita backend manages plan settings" on public.plan_settings;
create policy "Pepita backend manages plan settings"
on public.plan_settings
for all
to pepita_app
using (true)
with check (true);

drop policy if exists "Pepita backend manages billing subscriptions" on public.billing_subscriptions;
create policy "Pepita backend manages billing subscriptions"
on public.billing_subscriptions
for all
to pepita_app
using (true)
with check (true);

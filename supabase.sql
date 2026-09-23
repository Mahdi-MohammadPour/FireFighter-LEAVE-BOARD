create table if not exists public.leave_manager_state (
  id bigint primary key,
  data jsonb not null default '{"members":[],"leaves":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.leave_manager_state enable row level security;

revoke all on table public.leave_manager_state from anon, authenticated;
grant select, insert, update, delete on table public.leave_manager_state to anon, authenticated;

drop policy if exists "leave manager public read" on public.leave_manager_state;
drop policy if exists "leave manager public insert" on public.leave_manager_state;
drop policy if exists "leave manager public update" on public.leave_manager_state;
drop policy if exists "leave manager public delete" on public.leave_manager_state;

create policy "leave manager public read"
on public.leave_manager_state
for select to anon, authenticated
using (true);

create policy "leave manager public insert"
on public.leave_manager_state
for insert to anon, authenticated
with check (true);

create policy "leave manager public update"
on public.leave_manager_state
for update to anon, authenticated
using (true)
with check (true);

create policy "leave manager public delete"
on public.leave_manager_state
for delete to anon, authenticated
using (true);

-- برای همگام‌سازی لحظه‌ای تغییرات از Realtime استفاده می‌شود.
alter publication supabase_realtime add table public.leave_manager_state;

-- فقط یک رکورد مشترک برای کل سایت
insert into public.leave_manager_state (id, data)
values (1, '{"members":[],"leaves":[]}'::jsonb)
on conflict (id) do nothing;

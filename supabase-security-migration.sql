-- FireFighter Leave Board security migration
-- Run this once in Supabase SQL Editor BEFORE deploying the new frontend.
-- Existing leave_manager_state data is preserved.

create schema if not exists private;

create table if not exists public.ff_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  role text not null check (role in ('leader', 'subleader')),
  created_at timestamptz not null default now()
);

alter table public.ff_staff enable row level security;

-- Remove any older policies on the staff table.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'ff_staff'
  loop
    execute format('drop policy if exists %I on public.ff_staff', p.policyname);
  end loop;
end $$;

revoke all on table public.ff_staff from anon, authenticated;
grant select on table public.ff_staff to authenticated;

create policy "staff can read own row"
on public.ff_staff
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.is_staff()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.ff_staff
    where user_id = (select auth.uid())
      and role in ('leader', 'subleader')
  );
$$;

revoke all on function private.is_staff() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;

-- Make sure the shared state row exists before removing INSERT/DELETE privileges.
insert into public.leave_manager_state (id, data)
values (1, '{"members":[],"leaves":[]}'::jsonb)
on conflict (id) do nothing;

alter table public.leave_manager_state enable row level security;

-- Remove all existing policies from the shared state table.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'leave_manager_state'
  loop
    execute format('drop policy if exists %I on public.leave_manager_state', p.policyname);
  end loop;
end $$;

-- No anonymous access. Authenticated staff can only read/update the single state row.
revoke all on table public.leave_manager_state from anon, authenticated;
grant select, update on table public.leave_manager_state to authenticated;

create policy "staff can read shared state"
on public.leave_manager_state
for select
to authenticated
using ((select private.is_staff()) and id = 1);

create policy "staff can update shared state"
on public.leave_manager_state
for update
to authenticated
using ((select private.is_staff()) and id = 1)
with check ((select private.is_staff()) and id = 1);

-- Keep Realtime enabled for the single shared row.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leave_manager_state'
  ) then
    alter publication supabase_realtime add table public.leave_manager_state;
  end if;
end $$;

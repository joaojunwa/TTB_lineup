create table if not exists public.admin_profiles (
  login text primary key,
  birthday text not null,
  owner boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.admin_profiles enable row level security;

drop policy if exists "admin_profiles_select" on public.admin_profiles;
drop policy if exists "admin_profiles_insert" on public.admin_profiles;
drop policy if exists "admin_profiles_update" on public.admin_profiles;
drop policy if exists "admin_profiles_delete" on public.admin_profiles;

create policy "admin_profiles_select"
on public.admin_profiles
for select
using (true);

create policy "admin_profiles_insert"
on public.admin_profiles
for insert
with check (true);

create policy "admin_profiles_update"
on public.admin_profiles
for update
using (true)
with check (true);

create policy "admin_profiles_delete"
on public.admin_profiles
for delete
using (true);

insert into public.admin_profiles (login, birthday, owner)
values ('jun', '2001-07-13', true)
on conflict (login) do update
set birthday = excluded.birthday,
    owner = true;

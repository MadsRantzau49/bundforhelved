alter table public.clans
  add column image_path text;

-- Existing invite codes are replaced while the old format constraint is absent.
alter table public.clans
  drop constraint clans_invite_code_format;

with numbered_clans as (
  select id, pg_catalog.lpad(row_number() over (order by id)::text, 6, '0') as invite_code
  from public.clans
)
update public.clans as clan
set invite_code = numbered_clans.invite_code
from numbered_clans
where clan.id = numbered_clans.id;

alter table public.clans
  add constraint clans_invite_code_format check (
    invite_code ~ '^[0-9]{6}$'
  );

create or replace function public.generate_clan_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    candidate := pg_catalog.lpad(
      pg_catalog.floor(pg_catalog.random() * 1000000)::integer::text,
      6,
      '0'
    );

    if not exists (
      select 1
      from public.clans as c
      where c.invite_code = candidate
    ) then
      return candidate;
    end if;
  end loop;
end;
$$;

alter table public.clans
  alter column invite_code set default public.generate_clan_invite_code();

create or replace function public.is_clan_administrator(clan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      public.is_admin()
      or exists (
        select 1
        from public.clans as c
        where c.id = $1
          and c.created_by = auth.uid()
      )
    );
$$;

create or replace function public.can_manage_clan_image(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clan_id uuid;
begin
  if $1 !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image-[0-9]+(?:\.[a-z0-9]{1,16})?$' then
    return false;
  end if;

  clan_id := pg_catalog.split_part($1, '/', 1)::uuid;
  return public.is_clan_administrator(clan_id);
end;
$$;

create or replace function public.update_clan_details(
  clan uuid,
  name text,
  image_path text
)
returns public.clans
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_clan public.clans%rowtype;
  normalized_name text := pg_catalog.btrim(coalesce($2, ''));
  result public.clans%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(normalized_name) not between 2 and 64 then
    raise exception 'Clan name must be between 2 and 64 characters' using errcode = '22023';
  end if;

  select c.*
  into existing_clan
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if not public.is_clan_administrator(existing_clan.id) then
    raise exception 'Clan administrator access required' using errcode = '42501';
  end if;

  if $3 is not null and (
    pg_catalog.char_length($3) > 512
    or not public.can_manage_clan_image($3)
    or pg_catalog.left($3, pg_catalog.char_length(existing_clan.id::text || '/image-')) <> existing_clan.id::text || '/image-'
  ) then
    raise exception 'Clan image path must belong to this clan' using errcode = '22023';
  end if;

  update public.clans as c
  set name = normalized_name,
      image_path = $3
  where c.id = existing_clan.id
  returning c.* into result;

  return result;
end;
$$;

create or replace function public.add_friend_to_clan(clan uuid, friend uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_clan public.clans%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $2 is null or $2 = current_user_id then
    raise exception 'A different friend is required' using errcode = '22023';
  end if;

  select c.*
  into existing_clan
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if not public.is_clan_administrator(existing_clan.id) then
    raise exception 'Clan administrator access required' using errcode = '42501';
  end if;

  if not public.is_friend($2) then
    raise exception 'Only accepted friends can join a clan this way' using errcode = '42501';
  end if;

  insert into public.clan_members (clan_id, user_id, role)
  values (existing_clan.id, $2, 'member'::public.clan_member_role)
  on conflict (clan_id, user_id) do nothing;

  return true;
end;
$$;

create or replace function public.create_clan(name text)
returns public.clans
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(coalesce($1, ''));
  generated_code text;
  result public.clans%rowtype;
  created boolean := false;
  try_number integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(normalized_name) not between 2 and 64 then
    raise exception 'Clan name must be between 2 and 64 characters' using errcode = '22023';
  end if;

  for try_number in 1..5 loop
    generated_code := public.generate_clan_invite_code();
    begin
      insert into public.clans (name, invite_code, created_by)
      values (normalized_name, generated_code, current_user_id)
      returning * into result;
      created := true;
    exception
      when unique_violation then
        created := false;
    end;
    exit when created;
  end loop;

  if not created then
    raise exception 'Could not generate a unique clan invite code';
  end if;

  insert into public.clan_members (clan_id, user_id, role)
  values (result.id, current_user_id, 'owner'::public.clan_member_role);

  return result;
end;
$$;

create or replace function public.regenerate_clan_code(clan uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_clan public.clans%rowtype;
  generated_code text;
  try_number integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select c.*
  into existing_clan
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if not public.is_clan_administrator(existing_clan.id) then
    raise exception 'Clan administrator access required' using errcode = '42501';
  end if;

  for try_number in 1..5 loop
    generated_code := public.generate_clan_invite_code();
    if generated_code = existing_clan.invite_code then
      continue;
    end if;
    begin
      update public.clans as c
      set invite_code = generated_code
      where c.id = existing_clan.id;
      return generated_code;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'Could not generate a unique clan invite code';
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clan-images',
  'clan-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy clan_images_administrator_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'clan-images'
  and public.can_manage_clan_image(name)
)
with check (
  bucket_id = 'clan-images'
  and public.can_manage_clan_image(name)
);

revoke all on function public.generate_clan_invite_code() from public, anon, authenticated, service_role;
revoke all on function public.is_clan_administrator(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_manage_clan_image(text) from public, anon, authenticated, service_role;
revoke all on function public.update_clan_details(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.add_friend_to_clan(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_clan(text) from public, anon, authenticated, service_role;
revoke all on function public.regenerate_clan_code(uuid) from public, anon, authenticated, service_role;

grant execute on function public.is_clan_administrator(uuid) to authenticated;
grant execute on function public.can_manage_clan_image(text) to authenticated;
grant execute on function public.update_clan_details(uuid, text, text) to authenticated;
grant execute on function public.add_friend_to_clan(uuid, uuid) to authenticated;
grant execute on function public.create_clan(text) to authenticated;
grant execute on function public.regenerate_clan_code(uuid) to authenticated;

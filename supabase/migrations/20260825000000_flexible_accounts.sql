alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format check (
    username::text = pg_catalog.btrim(username::text)
    and pg_catalog.char_length(username::text) between 1 and 64
  );

create or replace function public.prevent_profile_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile id is immutable' using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  expected_email text;
begin
  requested_username := pg_catalog.btrim(
    coalesce(new.raw_user_meta_data ->> 'username', '')
  );

  if pg_catalog.char_length(requested_username) not between 1 and 64 then
    raise exception 'Username must contain between 1 and 64 characters'
      using errcode = '23514';
  end if;

  expected_email := pg_catalog.encode(
    extensions.digest(requested_username, 'sha256'),
    'hex'
  ) || '@users.bundforhelved.invalid';

  if new.email is distinct from expected_email then
    raise exception 'Account identity does not match username'
      using errcode = '23514';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);

  return new;
end;
$$;

create or replace function public.set_own_username(requested_username text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_username text := pg_catalog.btrim(coalesce($1, ''));
  result public.profiles%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(clean_username) not between 1 and 64 then
    raise exception 'Username must contain between 1 and 64 characters'
      using errcode = '23514';
  end if;

  update public.profiles as p
  set username = clean_username
  where p.id = current_user_id
  returning p.* into result;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.set_own_username(text) from public, anon, authenticated;
grant execute on function public.set_own_username(text) to authenticated;

update storage.buckets
set file_size_limit = null,
    allowed_mime_types = null
where id = 'avatars';

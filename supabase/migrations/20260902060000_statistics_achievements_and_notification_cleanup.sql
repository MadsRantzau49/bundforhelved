create table public.achievement_assets (
  achievement_key text primary key
    check (achievement_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  image_path text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table public.achievement_assets enable row level security;

create policy achievement_assets_authenticated_read
on public.achievement_assets
for select
to authenticated
using (true);

create policy achievement_assets_admin_manage
on public.achievement_assets
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

revoke all on table public.achievement_assets from public, anon, authenticated;
grant select, insert, update, delete on table public.achievement_assets to authenticated;
grant all on table public.achievement_assets to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'achievement-media',
  'achievement-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy achievement_media_admin_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'achievement-media'
  and (select public.is_admin())
)
with check (
  bucket_id = 'achievement-media'
  and (select public.is_admin())
);

create or replace function public.delete_all_notifications()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_count bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  delete from public.notifications
  where user_id = current_user_id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_all_notifications()
  from public, anon, authenticated, service_role;
grant execute on function public.delete_all_notifications() to authenticated;

comment on table public.achievement_assets is
  'Administrator-managed artwork for application-defined achievements.';
comment on column public.achievement_assets.image_path is
  'Object path in the public achievement-media bucket.';

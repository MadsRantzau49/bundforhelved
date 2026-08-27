alter table public.categories
  add column image_path text,
  add column guide_text text not null default '',
  add column guide_video_path text,
  add column demo_video_path text,
  add constraint categories_image_path_format check (
    image_path is null
    or (
      pg_catalog.char_length(image_path) between 1 and 512
      and image_path = pg_catalog.btrim(image_path)
      and image_path ~* '^[a-z0-9][a-z0-9._/-]*[.](jpe?g|png|webp|gif)$'
      and image_path !~ '(^|/)[.]{1,2}(/|$)'
      and image_path !~ '//'
    )
  ),
  add constraint categories_guide_text_length check (
    pg_catalog.char_length(guide_text) <= 50000
  ),
  add constraint categories_guide_video_path_format check (
    guide_video_path is null
    or (
      pg_catalog.char_length(guide_video_path) between 1 and 512
      and guide_video_path = pg_catalog.btrim(guide_video_path)
      and guide_video_path ~* '^[a-z0-9][a-z0-9._/-]*[.](mp4|webm|mov|qt)$'
      and guide_video_path !~ '(^|/)[.]{1,2}(/|$)'
      and guide_video_path !~ '//'
    )
  ),
  add constraint categories_demo_video_path_format check (
    demo_video_path is null
    or (
      pg_catalog.char_length(demo_video_path) between 1 and 512
      and demo_video_path = pg_catalog.btrim(demo_video_path)
      and demo_video_path ~* '^[a-z0-9][a-z0-9._/-]*[.](mp4|webm|mov|qt)$'
      and demo_video_path !~ '(^|/)[.]{1,2}(/|$)'
      and demo_video_path !~ '//'
    )
  );

alter table public.attempts
  add column review_code text,
  add column submitted_for_review_at timestamptz,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column evidence_video_path text,
  add column review_note text;

alter table public.attempts
  drop constraint if exists attempts_confirmation_state;

alter table public.attempts
  add constraint attempts_confirmation_state check (
    (
      status = 'approved'::public.attempt_status
      and confirmed_at is not null
    )
    or (
      status in (
        'running'::public.attempt_status,
        'awaiting_confirmation'::public.attempt_status,
        'pending_review'::public.attempt_status,
        'declined'::public.attempt_status
      )
      and confirmed_at is null
    )
    or status = 'invalidated'::public.attempt_status
  ),
  add constraint attempts_review_state check (
    (
      status = 'pending_review'::public.attempt_status
      and review_code ~ '^[0-9]{2}$'
      and submitted_for_review_at is not null
      and reviewed_by is null
      and reviewed_at is null
      and review_note is null
    )
    or (
      status <> 'pending_review'::public.attempt_status
      and review_code is null
    )
  ),
  add constraint attempts_submitted_after_stop check (
    submitted_for_review_at is null
    or (
      stopped_at is not null
      and submitted_for_review_at >= stopped_at
    )
  ),
  add constraint attempts_reviewed_after_stop check (
    reviewed_at is null
    or (
      stopped_at is not null
      and reviewed_at >= stopped_at
      and (
        submitted_for_review_at is null
        or reviewed_at >= submitted_for_review_at
      )
    )
  ),
  add constraint attempts_reviewer_timestamp check (
    reviewed_by is null or reviewed_at is not null
  ),
  add constraint attempts_review_note_format check (
    review_note is null
    or (
      review_note = pg_catalog.btrim(review_note)
      and pg_catalog.char_length(review_note) between 1 and 2000
    )
  ),
  add constraint attempts_evidence_video_path_format check (
    evidence_video_path is null
    or (
      pg_catalog.char_length(evidence_video_path) <= 512
      and evidence_video_path ~ (
        '^' || id::text || '/evidence-[0-9]{10,17}[.](mp4|webm|mov|qt)$'
      )
    )
  );

drop index if exists public.attempts_scope_leaderboard_idx;

create index attempts_leaderboard_global_idx
  on public.attempts (category_id, user_id, elapsed_ms, status, id)
  where status in (
      'approved'::public.attempt_status,
      'pending_review'::public.attempt_status
    )
    and invalidated_at is null;

create index attempts_leaderboard_clan_idx
  on public.attempts (category_id, clan_id, user_id, elapsed_ms, status, id)
  where status in (
      'approved'::public.attempt_status,
      'pending_review'::public.attempt_status
    )
    and invalidated_at is null;

create index attempts_pending_review_idx
  on public.attempts (submitted_for_review_at desc, id)
  where status = 'pending_review'::public.attempt_status;

create or replace function public.enforce_attempt_clan_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.clan_id is null then
    return new;
  end if;

  -- Preserve a historical attempt when profile deletion applies ON DELETE SET NULL.
  if tg_op = 'UPDATE' and old.recorded_by is not null and new.recorded_by is null then
    return new;
  end if;

  perform 1
  from public.clan_members as player_membership
  where player_membership.clan_id = new.clan_id
    and player_membership.user_id = new.user_id
  for key share;

  if not found then
    raise exception 'Player clan membership required' using errcode = '42501';
  end if;

  -- Admin RPCs validate the selected player but may preserve an out-of-clan recorder.
  if auth.uid() is not null and public.is_admin() then
    return new;
  end if;

  -- A deleted recorder remains a valid historical audit state. Every recorder that
  -- still exists must be a current member for ordinary scoped changes.
  if new.recorded_by is null then
    return new;
  end if;

  perform 1
  from public.clan_members as recorder_membership
  where recorder_membership.clan_id = new.clan_id
    and recorder_membership.user_id = new.recorded_by
  for key share;

  if not found then
    raise exception 'Recorder clan membership required' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.confirm_attempt(attempt uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_submitted_at timestamptz;
  generated_review_code text;
  random_value integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.user_id = current_user_id or a.recorded_by = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'awaiting_confirmation'::public.attempt_status then
    raise exception 'Only an awaiting attempt can be submitted for review'
      using errcode = '22023';
  end if;

  server_submitted_at := pg_catalog.clock_timestamp();
  if server_submitted_at < existing_attempt.stopped_at then
    server_submitted_at := existing_attempt.stopped_at;
  end if;

  loop
    random_value := pg_catalog.get_byte(extensions.gen_random_bytes(1), 0);
    exit when random_value < 200;
  end loop;

  generated_review_code := pg_catalog.lpad((random_value % 100)::text, 2, '0');

  update public.attempts as a
  set status = 'pending_review'::public.attempt_status,
      review_code = generated_review_code,
      submitted_for_review_at = server_submitted_at,
      confirmed_at = null,
      reviewed_by = null,
      reviewed_at = null,
      review_note = null,
      invalidated_at = null,
      invalidated_by = null,
      invalidated_reason = null
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.review_attempt(
  attempt uuid,
  code text,
  approve boolean
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_reviewed_at timestamptz;
begin
  if reviewer_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $2 is null or $2 !~ '^[0-9]{2}$' then
    raise exception 'Review code must be exactly two digits' using errcode = '22023';
  end if;

  if $3 is null then
    raise exception 'Review decision is required' using errcode = '22023';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'pending_review'::public.attempt_status then
    raise exception 'Attempt is not pending peer review' using errcode = '22023';
  end if;

  if reviewer_id = existing_attempt.user_id
     or reviewer_id = existing_attempt.recorded_by then
    raise exception 'A different account must review this attempt'
      using errcode = '42501';
  end if;

  if existing_attempt.review_code is distinct from $2 then
    raise exception 'Incorrect review code' using errcode = '22023';
  end if;

  server_reviewed_at := pg_catalog.clock_timestamp();
  if server_reviewed_at < existing_attempt.submitted_for_review_at then
    server_reviewed_at := existing_attempt.submitted_for_review_at;
  end if;

  if $3 then
    update public.attempts as a
    set status = 'approved'::public.attempt_status,
        review_code = null,
        confirmed_at = server_reviewed_at,
        reviewed_by = reviewer_id,
        reviewed_at = server_reviewed_at,
        review_note = null
    where a.id = existing_attempt.id
    returning a.* into result;
  else
    update public.attempts as a
    set status = 'declined'::public.attempt_status,
        review_code = null,
        confirmed_at = null,
        reviewed_by = reviewer_id,
        reviewed_at = server_reviewed_at,
        review_note = 'Declined by peer reviewer.'
    where a.id = existing_attempt.id
    returning a.* into result;
  end if;

  return result;
end;
$$;

create or replace function public.list_peer_review_attempts()
returns table (
  attempt_id uuid,
  user_id uuid,
  username text,
  avatar_path text,
  category_id uuid,
  category_name text,
  category_icon_key text,
  category_accent_color text,
  clan_id uuid,
  clan_name text,
  elapsed_ms bigint,
  stopped_at timestamptz,
  submitted_for_review_at timestamptz,
  evidence_video_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    p.id,
    p.username::text,
    p.avatar_path,
    c.id,
    c.name,
    c.icon_key,
    c.accent_color,
    a.clan_id,
    clan.name,
    a.elapsed_ms,
    a.stopped_at,
    a.submitted_for_review_at,
    a.evidence_video_path
  from public.attempts as a
  join public.profiles as p on p.id = a.user_id
  join public.categories as c on c.id = a.category_id
  left join public.clans as clan on clan.id = a.clan_id
  where a.status = 'pending_review'::public.attempt_status
    and a.user_id <> current_user_id
    and (a.recorded_by is null or a.recorded_by <> current_user_id)
  order by a.submitted_for_review_at desc, a.id
  limit 100;
end;
$$;

-- This helper lets storage RLS check peer eligibility without granting reviewers
-- direct access to attempts.review_code.
create or replace function public.can_review_attempt_video(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and $1 is not null
    and exists (
      select 1
      from public.attempts as a
      where a.status = 'pending_review'::public.attempt_status
        and a.evidence_video_path = $1
        and a.id::text = pg_catalog.split_part($1, '/', 1)
        and a.user_id <> auth.uid()
        and (a.recorded_by is null or a.recorded_by <> auth.uid())
    );
$$;

create or replace function public.set_attempt_evidence(
  attempt uuid,
  path text
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.user_id = current_user_id or a.recorded_by = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'awaiting_confirmation'::public.attempt_status then
    raise exception 'Evidence can only be set while awaiting confirmation'
      using errcode = '22023';
  end if;

  if $2 is null
     or pg_catalog.char_length($2) > 512
     or $2 !~ (
       '^' || existing_attempt.id::text
       || '/evidence-[0-9]{10,17}[.](mp4|webm|mov|qt)$'
     ) then
    raise exception 'Evidence path must belong to the attempt and use a safe video filename'
      using errcode = '22023';
  end if;

  update public.attempts as a
  set evidence_video_path = $2
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.change_attempt_scope(
  attempt uuid,
  clan uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.user_id = current_user_id or a.recorded_by = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'awaiting_confirmation'::public.attempt_status then
    raise exception 'Scope can only be changed while awaiting confirmation'
      using errcode = '22023';
  end if;

  if $2 is not null then
    perform 1
    from public.clans as c
    where c.id = $2
    for key share;

    if not found then
      raise exception 'Clan not found' using errcode = 'P0002';
    end if;

    perform 1
    from public.clan_members as player_membership
    where player_membership.clan_id = $2
      and player_membership.user_id = existing_attempt.user_id
    for key share;

    if not found then
      raise exception 'Player clan membership required' using errcode = '42501';
    end if;

    if existing_attempt.recorded_by is not null then
      perform 1
      from public.clan_members as recorder_membership
      where recorder_membership.clan_id = $2
        and recorder_membership.user_id = existing_attempt.recorded_by
      for key share;

      if not found then
        raise exception 'Recorder clan membership required' using errcode = '42501';
      end if;
    end if;
  end if;

  update public.attempts as a
  set clan_id = $2
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.admin_update_attempt(
  attempt uuid,
  player uuid,
  category uuid,
  clan uuid,
  elapsed bigint,
  valid boolean,
  reason text
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  action_at timestamptz;
  normalized_reason text := pg_catalog.btrim(coalesce($7, ''));
begin
  if administrator_id is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if $2 is null then
    raise exception 'Player is required' using errcode = '22023';
  end if;

  if $3 is null then
    raise exception 'Category is required' using errcode = '22023';
  end if;

  if $5 is null or $5 < 0 then
    raise exception 'Elapsed time must be nonnegative' using errcode = '22023';
  end if;

  if pg_catalog.char_length(normalized_reason) > 2000 then
    raise exception 'Reason must not exceed 2000 characters' using errcode = '22023';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status = 'running'::public.attempt_status then
    raise exception 'Only a stopped attempt can be managed' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as p
  where p.id = $2
  for key share;

  if not found then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.categories as c
  where c.id = $3
  for key share;

  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;

  if $4 is not null then
    perform 1
    from public.clans as c
    where c.id = $4
    for key share;

    if not found then
      raise exception 'Clan not found' using errcode = 'P0002';
    end if;

    perform 1
    from public.clan_members as cm
    where cm.clan_id = $4
      and cm.user_id = $2
    for key share;

    if not found then
      raise exception 'Player clan membership required' using errcode = '42501';
    end if;
  end if;

  if existing_attempt.user_id <> $2 then
    insert into public.attempt_attribution_events (
      attempt_id,
      from_user_id,
      to_user_id,
      changed_by
    )
    values (
      existing_attempt.id,
      existing_attempt.user_id,
      $2,
      administrator_id
    );
  end if;

  action_at := pg_catalog.clock_timestamp();
  if action_at < existing_attempt.stopped_at then
    action_at := existing_attempt.stopped_at;
  end if;
  if existing_attempt.submitted_for_review_at is not null
     and action_at < existing_attempt.submitted_for_review_at then
    action_at := existing_attempt.submitted_for_review_at;
  end if;

  if $6 is null then
    update public.attempts as a
    set user_id = $2,
        category_id = $3,
        clan_id = $4,
        elapsed_ms = $5
    where a.id = existing_attempt.id
    returning a.* into result;
  elsif $6 then
    if normalized_reason = '' then
      normalized_reason := 'Approved by administrator.';
    end if;

    update public.attempts as a
    set user_id = $2,
        category_id = $3,
        clan_id = $4,
        elapsed_ms = $5,
        status = 'approved'::public.attempt_status,
        confirmed_at = action_at,
        invalidated_at = null,
        invalidated_by = null,
        invalidated_reason = null,
        review_code = null,
        reviewed_by = administrator_id,
        reviewed_at = action_at,
        review_note = normalized_reason
    where a.id = existing_attempt.id
    returning a.* into result;
  else
    if normalized_reason = '' then
      normalized_reason := 'Marked invalid by administrator.';
    end if;

    update public.attempts as a
    set user_id = $2,
        category_id = $3,
        clan_id = $4,
        elapsed_ms = $5,
        status = 'invalidated'::public.attempt_status,
        invalidated_at = action_at,
        invalidated_by = administrator_id,
        invalidated_reason = normalized_reason,
        review_code = null
    where a.id = existing_attempt.id
    returning a.* into result;
  end if;

  return result;
end;
$$;

create or replace function public.invalidate_attempt(
  attempt uuid,
  reason text
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  normalized_reason text := pg_catalog.btrim(coalesce($2, ''));
  invalidated_at_value timestamptz;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if normalized_reason = '' then
    normalized_reason := 'Marked invalid by administrator.';
  end if;

  if pg_catalog.char_length(normalized_reason) > 2000 then
    raise exception 'Reason must not exceed 2000 characters' using errcode = '22023';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status = 'running'::public.attempt_status then
    raise exception 'Only a stopped attempt can be invalidated' using errcode = '22023';
  end if;

  invalidated_at_value := pg_catalog.clock_timestamp();
  if invalidated_at_value < existing_attempt.stopped_at then
    invalidated_at_value := existing_attempt.stopped_at;
  end if;

  update public.attempts as a
  set status = 'invalidated'::public.attempt_status,
      invalidated_at = invalidated_at_value,
      invalidated_by = auth.uid(),
      invalidated_reason = normalized_reason,
      review_code = null
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

drop function if exists public.get_leaderboard(uuid, uuid);

create function public.get_leaderboard(
  category uuid,
  clan uuid default null
)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  avatar_path text,
  elapsed_ms bigint,
  attempt_id uuid,
  status public.attempt_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.categories as c
    where c.id = $1
      and (c.is_active or public.is_admin())
  ) then
    raise exception 'Category not found or inactive' using errcode = 'P0002';
  end if;

  if $2 is not null and not exists (
    select 1
    from public.clan_members as caller_membership
    where caller_membership.clan_id = $2
      and caller_membership.user_id = current_user_id
  ) then
    raise exception 'Clan membership required' using errcode = '42501';
  end if;

  return query
  with best_attempts as (
    select distinct on (a.user_id)
      a.user_id,
      a.elapsed_ms,
      a.id as attempt_id,
      a.status
    from public.attempts as a
    where a.category_id = $1
      and a.status in (
        'approved'::public.attempt_status,
        'pending_review'::public.attempt_status
      )
      and a.invalidated_at is null
      and (
        $2 is null
        or (
          a.clan_id = $2
          and exists (
            select 1
            from public.clan_members as current_member
            where current_member.clan_id = $2
              and current_member.user_id = a.user_id
          )
        )
      )
    order by
      a.user_id,
      a.elapsed_ms,
      case when a.status = 'approved'::public.attempt_status then 0 else 1 end,
      coalesce(a.confirmed_at, a.submitted_for_review_at, a.stopped_at),
      a.id
  ),
  ranked_attempts as (
    select
      rank() over (order by best.elapsed_ms) as leaderboard_rank,
      best.user_id,
      best.elapsed_ms,
      best.attempt_id,
      best.status
    from best_attempts as best
  )
  select
    ranked.leaderboard_rank,
    profile.id,
    profile.username::text,
    profile.avatar_path,
    ranked.elapsed_ms,
    ranked.attempt_id,
    ranked.status
  from ranked_attempts as ranked
  join public.profiles as profile on profile.id = ranked.user_id
  order by ranked.leaderboard_rank, profile.username::text, profile.id;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'category-media',
    'category-media',
    true,
    47185920,
    array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ]::text[]
  ),
  (
    'attempt-videos',
    'attempt-videos',
    false,
    47185920,
    array['video/mp4', 'video/webm', 'video/quicktime']::text[]
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public delivery for category-media is handled by the bucket setting. Only
-- administrators receive object mutation privileges through storage RLS.
create policy category_media_admin_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'category-media'
  and (select public.is_admin())
)
with check (
  bucket_id = 'category-media'
  and (select public.is_admin())
);

create policy attempt_videos_participant_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'attempt-videos'
  and exists (
    select 1
    from public.attempts as a
    where pg_catalog.split_part(name, '/', 1) = a.id::text
      and pg_catalog.split_part(name, '/', 2)
        ~ '^evidence-[0-9]{10,17}[.](mp4|webm|mov|qt)$'
      and name = a.id::text || '/' || pg_catalog.split_part(name, '/', 2)
      and a.status = 'awaiting_confirmation'::public.attempt_status
      and (
        a.user_id = (select auth.uid())
        or a.recorded_by = (select auth.uid())
      )
  )
);

create policy attempt_videos_participant_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attempt-videos'
  and exists (
    select 1
    from public.attempts as a
    where pg_catalog.split_part(name, '/', 1) = a.id::text
      and pg_catalog.split_part(name, '/', 2)
        ~ '^evidence-[0-9]{10,17}[.](mp4|webm|mov|qt)$'
      and name = a.id::text || '/' || pg_catalog.split_part(name, '/', 2)
      and (
        a.user_id = (select auth.uid())
        or a.recorded_by = (select auth.uid())
      )
  )
);

create policy attempt_videos_participant_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'attempt-videos'
  and exists (
    select 1
    from public.attempts as a
    where pg_catalog.split_part(name, '/', 1) = a.id::text
      and pg_catalog.split_part(name, '/', 2)
        ~ '^evidence-[0-9]{10,17}[.](mp4|webm|mov|qt)$'
      and name = a.id::text || '/' || pg_catalog.split_part(name, '/', 2)
      and (
        a.user_id = (select auth.uid())
        or a.recorded_by = (select auth.uid())
      )
  )
);

create policy attempt_videos_peer_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attempt-videos'
  and public.can_review_attempt_video(name)
);

create policy attempt_videos_admin_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'attempt-videos'
  and (select public.is_admin())
)
with check (
  bucket_id = 'attempt-videos'
  and (select public.is_admin())
);

revoke all on function public.enforce_attempt_clan_memberships()
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_attempt(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.review_attempt(uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.list_peer_review_attempts()
  from public, anon, authenticated, service_role;
revoke all on function public.can_review_attempt_video(text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_attempt_evidence(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.change_attempt_scope(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_attempt(
  uuid, uuid, uuid, uuid, bigint, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.invalidate_attempt(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_leaderboard(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.confirm_attempt(uuid) to authenticated;
grant execute on function public.review_attempt(uuid, text, boolean) to authenticated;
grant execute on function public.list_peer_review_attempts() to authenticated;
grant execute on function public.can_review_attempt_video(text) to authenticated;
grant execute on function public.set_attempt_evidence(uuid, text) to authenticated;
grant execute on function public.change_attempt_scope(uuid, uuid) to authenticated;
grant execute on function public.admin_update_attempt(
  uuid, uuid, uuid, uuid, bigint, boolean, text
) to authenticated;
grant execute on function public.invalidate_attempt(uuid, text) to authenticated;
grant execute on function public.get_leaderboard(uuid, uuid) to authenticated;

comment on column public.categories.image_path is
  'Object path in the public category-media bucket.';
comment on column public.categories.guide_video_path is
  'Guide object path in the public category-media bucket.';
comment on column public.categories.demo_video_path is
  'Demonstration object path in the public category-media bucket.';
comment on column public.attempts.review_code is
  'Ephemeral two-digit code present only while pending peer review.';
comment on column public.attempts.submitted_for_review_at is
  'When the credited player or recorder submitted the stopped attempt for peer review.';
comment on column public.attempts.reviewed_by is
  'Peer reviewer or administrator responsible for the latest approval override.';
comment on column public.attempts.evidence_video_path is
  'Selected object path in the private attempt-videos bucket.';

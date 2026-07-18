create extension if not exists pgcrypto;

create table if not exists public.content_items (
  content_key text primary key,
  platform text not null check (platform in ('x', 'linkedin')),
  tweet_id text,
  url text,
  text_hash text,
  text_snapshot text,
  author_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `create table if not exists` does not update a deployed constraint, so keep
-- the live project aligned when adding LinkedIn to the two supported sources.
alter table public.content_items
  drop constraint if exists content_items_platform_check;
alter table public.content_items
  add constraint content_items_platform_check
  check (platform in ('x', 'linkedin'));

create table if not exists public.reviewers (
  reviewer_id text primary key,
  display_name text,
  reputation_weight numeric not null default 0.25 check (reputation_weight >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.community_votes (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  reviewer_id text not null references public.reviewers(reviewer_id) on delete cascade,
  vote text not null check (vote in ('looks_ai', 'looks_human', 'unsure')),
  reviewer_weight numeric not null check (reviewer_weight >= 0),
  created_at timestamptz not null default now(),
  unique (content_key, reviewer_id)
);

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  reviewer_id text not null references public.reviewers(reviewer_id) on delete cascade,
  reason text not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.verdict_history (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  event_type text not null,
  label text check (label in ('red', 'yellow', 'green', 'gray')),
  slop_score numeric check (slop_score is null or (slop_score >= 0 and slop_score <= 100)),
  detector_score numeric check (detector_score is null or (detector_score >= 0 and detector_score <= 100)),
  community_score numeric check (community_score is null or (community_score >= 0 and community_score <= 100)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.content_items enable row level security;
alter table public.reviewers enable row level security;
alter table public.community_votes enable row level security;
alter table public.appeals enable row level security;
alter table public.verdict_history enable row level security;

create or replace function public.submit_community_vote(
  p_content_key text,
  p_platform text,
  p_vote text,
  p_reviewer_id text,
  p_tweet_id text default null,
  p_url text default null,
  p_text_hash text default null,
  p_text_snapshot text default null,
  p_author_handle text default null
)
returns table (
  content_key text,
  reviewer_id text,
  vote text,
  reviewer_weight numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_weight numeric;
begin
  if coalesce(trim(p_content_key), '') = '' then
    raise exception 'content_key is required';
  end if;

  if coalesce(trim(p_reviewer_id), '') = '' then
    raise exception 'reviewer_id is required';
  end if;

  insert into public.content_items (
    content_key,
    platform,
    tweet_id,
    url,
    text_hash,
    text_snapshot,
    author_handle
  )
  values (
    p_content_key,
    p_platform,
    p_tweet_id,
    p_url,
    p_text_hash,
    p_text_snapshot,
    p_author_handle
  )
  on conflict on constraint content_items_pkey do update
  set
    tweet_id = coalesce(excluded.tweet_id, content_items.tweet_id),
    url = coalesce(excluded.url, content_items.url),
    text_hash = coalesce(excluded.text_hash, content_items.text_hash),
    text_snapshot = coalesce(excluded.text_snapshot, content_items.text_snapshot),
    author_handle = coalesce(excluded.author_handle, content_items.author_handle),
    updated_at = now();

  insert into public.reviewers (reviewer_id)
  values (p_reviewer_id)
  on conflict on constraint reviewers_pkey do nothing;

  select reputation_weight
  into canonical_weight
  from public.reviewers
  where reviewers.reviewer_id = p_reviewer_id;

  return query
  with saved_vote as (
    insert into public.community_votes (
      content_key,
      reviewer_id,
      vote,
      reviewer_weight
    )
    values (p_content_key, p_reviewer_id, p_vote, canonical_weight)
    on conflict on constraint community_votes_content_key_reviewer_id_key do update
    set
      vote = excluded.vote,
      reviewer_weight = excluded.reviewer_weight,
      created_at = now()
    returning
      community_votes.content_key,
      community_votes.reviewer_id,
      community_votes.vote,
      community_votes.reviewer_weight,
      community_votes.created_at
  ), recorded_history as (
    insert into public.verdict_history (content_key, event_type, metadata)
    select
      saved_vote.content_key,
      'community_vote_updated',
      jsonb_build_object(
        'reviewer_id', saved_vote.reviewer_id,
        'vote', saved_vote.vote,
        'reviewer_weight', saved_vote.reviewer_weight
      )
    from saved_vote
  )
  select
    saved_vote.content_key,
    saved_vote.reviewer_id,
    saved_vote.vote,
    saved_vote.reviewer_weight,
    saved_vote.created_at
  from saved_vote;
end;
$$;

revoke all on function public.submit_community_vote(
  text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.submit_community_vote(
  text, text, text, text, text, text, text, text, text
) to anon, authenticated;

create or replace view public.community_aggregates as
select
  ci.content_key,
  count(cv.id)::integer as vote_count,
  case
    when coalesce(sum(cv.reviewer_weight), 0) = 0 then null
    else (
      sum(
        case cv.vote
          when 'looks_ai' then 100
          when 'unsure' then 50
          when 'looks_human' then 0
        end * cv.reviewer_weight
      ) / sum(cv.reviewer_weight)
    )
  end as weighted_ai_score,
  coalesce(sum(cv.reviewer_weight) filter (where cv.vote = 'looks_ai'), 0) as looks_ai_weight,
  coalesce(sum(cv.reviewer_weight) filter (where cv.vote = 'looks_human'), 0) as looks_human_weight,
  coalesce(sum(cv.reviewer_weight) filter (where cv.vote = 'unsure'), 0) as unsure_weight,
  coalesce(
    (
      select a.status
      from public.appeals a
      where a.content_key = ci.content_key
      order by a.created_at desc
      limit 1
    ),
    'none'
  ) as appeal_status,
  (
    select vh.label
    from public.verdict_history vh
    where vh.content_key = ci.content_key and vh.label is not null
    order by vh.created_at desc
    limit 1
  ) as latest_verdict_label,
  greatest(
    ci.updated_at,
    coalesce(max(cv.created_at), ci.updated_at)
  ) as updated_at
from public.content_items ci
left join public.community_votes cv on cv.content_key = ci.content_key
group by ci.content_key, ci.updated_at;

create or replace function public.get_community_aggregate(p_content_key text)
returns table (
  content_key text,
  vote_count integer,
  weighted_ai_score numeric,
  looks_ai_weight numeric,
  looks_human_weight numeric,
  unsure_weight numeric,
  appeal_status text,
  latest_verdict_label text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    aggregates.content_key,
    aggregates.vote_count,
    aggregates.weighted_ai_score,
    aggregates.looks_ai_weight,
    aggregates.looks_human_weight,
    aggregates.unsure_weight,
    aggregates.appeal_status,
    aggregates.latest_verdict_label,
    aggregates.updated_at
  from public.community_aggregates as aggregates
  where aggregates.content_key = p_content_key;
$$;

revoke all on function public.get_community_aggregate(text) from public;
grant execute on function public.get_community_aggregate(text) to anon, authenticated;

create or replace function public.submit_appeal(
  p_content_key text,
  p_reviewer_id text,
  p_reason text,
  p_status text default 'submitted'
)
returns table (
  id uuid,
  content_key text,
  reviewer_id text,
  reason text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_content_key), '') = '' then
    raise exception 'content_key is required';
  end if;

  if coalesce(trim(p_reviewer_id), '') = '' then
    raise exception 'reviewer_id is required';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason is required';
  end if;

  return query
  with saved_appeal as (
    insert into public.appeals (content_key, reviewer_id, reason, status)
    values (p_content_key, p_reviewer_id, p_reason, p_status)
    returning
      appeals.id,
      appeals.content_key,
      appeals.reviewer_id,
      appeals.reason,
      appeals.status,
      appeals.created_at
  ), recorded_history as (
    insert into public.verdict_history (content_key, event_type, metadata)
    select
      saved_appeal.content_key,
      'appeal_submitted',
      jsonb_build_object(
        'appeal_id', saved_appeal.id,
        'reviewer_id', saved_appeal.reviewer_id,
        'reason', saved_appeal.reason,
        'status', saved_appeal.status
      )
    from saved_appeal
  )
  select
    saved_appeal.id,
    saved_appeal.content_key,
    saved_appeal.reviewer_id,
    saved_appeal.reason,
    saved_appeal.status,
    saved_appeal.created_at
  from saved_appeal;
end;
$$;

revoke all on function public.submit_appeal(text, text, text, text) from public;
grant execute on function public.submit_appeal(text, text, text, text)
to anon, authenticated;

create or replace function public.record_verdict_history(
  p_content_key text,
  p_event_type text,
  p_label text default null,
  p_slop_score numeric default null,
  p_detector_score numeric default null,
  p_community_score numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content_key text,
  event_type text,
  label text,
  slop_score numeric,
  detector_score numeric,
  community_score numeric,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_content_key), '') = '' then
    raise exception 'content_key is required';
  end if;

  if p_event_type not in (
    'initial_score',
    'community_vote_updated',
    'appeal_submitted',
    'appeal_resolved',
    'label_changed'
  ) then
    raise exception 'unsupported verdict event type';
  end if;

  return query
  insert into public.verdict_history (
    content_key,
    event_type,
    label,
    slop_score,
    detector_score,
    community_score,
    metadata
  )
  values (
    p_content_key,
    p_event_type,
    p_label,
    p_slop_score,
    p_detector_score,
    p_community_score,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning
    verdict_history.id,
    verdict_history.content_key,
    verdict_history.event_type,
    verdict_history.label,
    verdict_history.slop_score,
    verdict_history.detector_score,
    verdict_history.community_score,
    verdict_history.metadata,
    verdict_history.created_at;
end;
$$;

revoke all on function public.record_verdict_history(
  text, text, text, numeric, numeric, numeric, jsonb
) from public;
grant execute on function public.record_verdict_history(
  text, text, text, numeric, numeric, numeric, jsonb
) to anon, authenticated;

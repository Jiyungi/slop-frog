create extension if not exists pgcrypto;

create table if not exists public.content_items (
  content_key text primary key,
  platform text not null check (platform in ('x')),
  tweet_id text,
  url text,
  text_hash text,
  text_snapshot text,
  author_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

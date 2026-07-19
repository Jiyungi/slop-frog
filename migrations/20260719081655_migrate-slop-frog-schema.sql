create table if not exists public.content_items (
  content_key text primary key,
  platform text not null check (platform in ('x', 'linkedin')),
  post_id text,
  url text,
  text_hash text,
  text_snapshot text,
  author_handle_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_items_platform_post_id_idx
  on public.content_items (platform, post_id);

create index if not exists content_items_text_hash_idx
  on public.content_items (text_hash);

create table if not exists public.reviewers (
  reviewer_id text primary key,
  display_name text,
  quality_weight numeric not null default 0.25 check (quality_weight >= 0 and quality_weight <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  tier text not null default 'public_guest' check (tier in ('public_guest', 'public_signed_in', 'owner_admin')),
  owner_bypass boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_votes (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  reviewer_id text not null references public.reviewers(reviewer_id) on delete cascade,
  vote text not null check (vote in ('looks_ai', 'looks_human', 'unsure')),
  reviewer_weight numeric not null default 0.25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_key, reviewer_id)
);

create index if not exists community_votes_content_key_idx
  on public.community_votes (content_key);

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  reviewer_id text not null references public.reviewers(reviewer_id) on delete cascade,
  reason text not null check (reason in ('human_written', 'ai_assisted_not_fully_ai', 'missing_context', 'other')),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists appeals_content_key_idx
  on public.appeals (content_key, created_at desc);

create table if not exists public.verdict_history (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  event_type text not null,
  label text check (label in ('red', 'yellow', 'green', 'gray')),
  slop_score numeric,
  detector_score numeric,
  community_score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists verdict_history_content_key_created_idx
  on public.verdict_history (content_key, created_at);

create table if not exists public.score_cache (
  content_key text primary key references public.content_items(content_key) on delete cascade,
  platform text not null check (platform in ('x', 'linkedin')),
  detector_score numeric,
  evidence_coverage numeric not null default 0,
  label text not null check (label in ('red', 'yellow', 'green', 'gray')),
  model_name text,
  model_version text,
  reasons jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists score_cache_expires_at_idx
  on public.score_cache (expires_at);

create table if not exists public.rate_limit_buckets (
  subject_key text primary key,
  tier text not null check (tier in ('public_guest', 'public_signed_in', 'owner_admin')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  used integer not null default 0 check (used >= 0),
  quota integer not null check (quota >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  subject_key text not null,
  content_key text,
  tier text not null,
  decision text not null check (decision in ('cache_hit', 'live_allowed', 'rate_limited', 'owner_bypass')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_subject_created_idx
  on public.rate_limit_events (subject_key, created_at desc);

create table if not exists public.training_candidates (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  source_event text not null check (source_event in ('vote', 'appeal', 'manual')),
  label text,
  cleaning_status text not null default 'pending' check (cleaning_status in ('pending', 'cleaned', 'rejected')),
  pii_risk text not null default 'unknown' check (pii_risk in ('unknown', 'low', 'medium', 'high')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (content_key, source_event)
);

create index if not exists training_candidates_cleaning_idx
  on public.training_candidates (cleaning_status, pii_risk, created_at);

create table if not exists public.dataset_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'created' check (status in ('created', 'cleaning', 'ready', 'rejected', 'exported')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  cleaning_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.dataset_batch_items (
  batch_id uuid not null references public.dataset_batches(id) on delete cascade,
  training_candidate_id uuid not null references public.training_candidates(id) on delete cascade,
  primary key (batch_id, training_candidate_id)
);

create table if not exists public.benchmark_examples (
  id uuid primary key default gen_random_uuid(),
  content_key_hash text not null,
  source_platform text not null check (source_platform in ('x', 'linkedin')),
  cleaned_text text not null,
  label text not null check (label in ('looks_ai', 'looks_human', 'unsure')),
  community_score numeric,
  vote_count integer not null default 0,
  detector_score numeric,
  model_name text,
  model_version text,
  pii_cleaned boolean not null default true,
  public_exportable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (content_key_hash)
);

create table if not exists public.model_registry (
  id uuid primary key default gen_random_uuid(),
  model_name text not null,
  model_version text not null,
  modal_endpoint text,
  eval_status text not null default 'pending' check (eval_status in ('pending', 'running', 'passing', 'failing', 'blocked')),
  promoted boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (model_name, model_version)
);

create table if not exists public.eval_results (
  id uuid primary key default gen_random_uuid(),
  model_registry_id uuid references public.model_registry(id) on delete set null,
  eval_suite text not null,
  status text not null check (status in ('passing', 'failing', 'blocked')),
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.community_aggregates as
select
  v.content_key,
  count(*)::integer as vote_count,
  case
    when sum(nullif(v.reviewer_weight, 0)) is null then null
    else round(
      (
        sum(
          case v.vote
            when 'looks_ai' then 100
            when 'unsure' then 50
            else 0
          end * v.reviewer_weight
        ) / nullif(sum(v.reviewer_weight), 0)
      )::numeric,
      0
    )
  end as community_score,
  sum(case when v.vote = 'looks_ai' then v.reviewer_weight else 0 end) as looks_ai_weight,
  sum(case when v.vote = 'looks_human' then v.reviewer_weight else 0 end) as looks_human_weight,
  sum(case when v.vote = 'unsure' then v.reviewer_weight else 0 end) as unsure_weight,
  max(v.updated_at) as updated_at
from public.community_votes v
group by v.content_key;

create or replace function public.clean_benchmark_text(input_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          coalesce(input_text, ''),
          'https?://\S+',
          '[url]',
          'gi'
        ),
        '@[A-Za-z0-9_]+',
        '[handle]',
        'g'
      ),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
      '[email]',
      'gi'
    )
  );
$$;

create or replace function public.upsert_content_item(
  p_content_key text,
  p_platform text,
  p_post_id text default null,
  p_url text default null,
  p_text_hash text default null,
  p_text_snapshot text default null,
  p_author_handle text default null
)
returns public.content_items
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_item public.content_items;
begin
  if p_content_key is null or p_platform is null then
    raise exception 'content_key and platform are required';
  end if;

  insert into public.content_items (
    content_key,
    platform,
    post_id,
    url,
    text_hash,
    text_snapshot,
    author_handle_hash,
    updated_at
  )
  values (
    p_content_key,
    p_platform,
    p_post_id,
    p_url,
    p_text_hash,
    nullif(p_text_snapshot, ''),
    case when nullif(p_author_handle, '') is null then null else md5(lower(p_author_handle)) end,
    now()
  )
  on conflict (content_key) do update set
    platform = excluded.platform,
    post_id = coalesce(excluded.post_id, public.content_items.post_id),
    url = coalesce(excluded.url, public.content_items.url),
    text_hash = coalesce(excluded.text_hash, public.content_items.text_hash),
    text_snapshot = coalesce(excluded.text_snapshot, public.content_items.text_snapshot),
    author_handle_hash = coalesce(excluded.author_handle_hash, public.content_items.author_handle_hash),
    updated_at = now()
  returning * into saved_item;

  return saved_item;
end;
$$;

create or replace function public.get_community_aggregate(p_content_key text)
returns table (
  content_key text,
  vote_count integer,
  community_score numeric,
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
as $$
  select
    p_content_key as content_key,
    coalesce(a.vote_count, 0) as vote_count,
    a.community_score,
    a.community_score as weighted_ai_score,
    coalesce(a.looks_ai_weight, 0) as looks_ai_weight,
    coalesce(a.looks_human_weight, 0) as looks_human_weight,
    coalesce(a.unsure_weight, 0) as unsure_weight,
    coalesce(
      (
        select ap.status
        from public.appeals ap
        where ap.content_key = p_content_key
        order by ap.created_at desc
        limit 1
      ),
      'none'
    ) as appeal_status,
    (
      select vh.label
      from public.verdict_history vh
      where vh.content_key = p_content_key
      order by vh.created_at desc
      limit 1
    ) as latest_verdict_label,
    a.updated_at
  from (select p_content_key) key
  left join public.community_aggregates a on a.content_key = key.p_content_key;
$$;

create or replace function public.submit_community_vote(
  p_content_key text,
  p_platform text,
  p_vote text,
  p_reviewer_id text,
  p_post_id text default null,
  p_tweet_id text default null,
  p_url text default null,
  p_text_hash text default null,
  p_text_snapshot text default null,
  p_author_handle text default null
)
returns table (
  id uuid,
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
  saved_vote public.community_votes;
  weight numeric;
begin
  perform public.upsert_content_item(
    p_content_key,
    p_platform,
    coalesce(p_post_id, p_tweet_id),
    p_url,
    p_text_hash,
    p_text_snapshot,
    p_author_handle
  );

  insert into public.reviewers (reviewer_id)
  values (p_reviewer_id)
  on conflict (reviewer_id) do update set updated_at = now();

  select quality_weight into weight
  from public.reviewers
  where reviewers.reviewer_id = p_reviewer_id;

  insert into public.community_votes (
    content_key,
    reviewer_id,
    vote,
    reviewer_weight,
    updated_at
  )
  values (p_content_key, p_reviewer_id, p_vote, coalesce(weight, 0.25), now())
  on conflict (content_key, reviewer_id) do update set
    vote = excluded.vote,
    reviewer_weight = excluded.reviewer_weight,
    updated_at = now()
  returning * into saved_vote;

  update public.reviewers
  set review_count = (
    select count(*)::integer
    from public.community_votes
    where community_votes.reviewer_id = p_reviewer_id
  ),
  updated_at = now()
  where reviewers.reviewer_id = p_reviewer_id;

  insert into public.training_candidates (content_key, source_event, label, cleaning_status, pii_risk, metadata)
  values (
    p_content_key,
    'vote',
    p_vote,
    'pending',
    case when nullif(p_text_snapshot, '') is null then 'unknown' else 'medium' end,
    jsonb_build_object('platform', p_platform)
  )
  on conflict (content_key, source_event) do update set
    label = excluded.label,
    metadata = public.training_candidates.metadata || excluded.metadata;

  insert into public.verdict_history (
    content_key,
    event_type,
    community_score,
    metadata
  )
  select
    p_content_key,
    'community_vote',
    community_score,
    jsonb_build_object('vote', p_vote, 'reviewer_weight', coalesce(weight, 0.25))
  from public.get_community_aggregate(p_content_key);

  return query
  select
    saved_vote.id,
    saved_vote.content_key,
    saved_vote.reviewer_id,
    saved_vote.vote,
    saved_vote.reviewer_weight,
    saved_vote.created_at;
end;
$$;

create or replace function public.submit_appeal(
  p_content_key text,
  p_reviewer_id text,
  p_reason text,
  p_status text default 'submitted'
)
returns public.appeals
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_appeal public.appeals;
begin
  insert into public.reviewers (reviewer_id)
  values (p_reviewer_id)
  on conflict (reviewer_id) do update set updated_at = now();

  insert into public.appeals (content_key, reviewer_id, reason, status)
  values (p_content_key, p_reviewer_id, p_reason, coalesce(p_status, 'submitted'))
  returning * into saved_appeal;

  insert into public.training_candidates (content_key, source_event, label, cleaning_status, pii_risk, metadata)
  values (
    p_content_key,
    'appeal',
    p_reason,
    'pending',
    'unknown',
    jsonb_build_object('appeal_status', coalesce(p_status, 'submitted'))
  )
  on conflict (content_key, source_event) do update set
    label = excluded.label,
    metadata = public.training_candidates.metadata || excluded.metadata;

  insert into public.verdict_history (content_key, event_type, metadata)
  values (
    p_content_key,
    'appeal_submitted',
    jsonb_build_object('reason', p_reason, 'status', coalesce(p_status, 'submitted'))
  );

  return saved_appeal;
end;
$$;

create or replace function public.record_verdict_history(
  p_content_key text,
  p_event_type text,
  p_label text default null,
  p_slop_score numeric default null,
  p_detector_score numeric default null,
  p_community_score numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.verdict_history
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_entry public.verdict_history;
begin
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
  returning * into saved_entry;

  return saved_entry;
end;
$$;

create or replace function public.get_verdict_history(p_content_key text, p_limit integer default 20)
returns table (
  created_at timestamptz,
  slop_score numeric,
  label text,
  event_type text
)
language sql
stable
as $$
  select
    vh.created_at,
    vh.slop_score,
    vh.label,
    vh.event_type
  from public.verdict_history vh
  where vh.content_key = p_content_key
  order by vh.created_at asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.resolve_score_plan(
  p_content_key text,
  p_platform text,
  p_subject_key text,
  p_tier text default 'public_guest',
  p_public_quota integer default 1
)
returns table (
  decision text,
  should_call_detector boolean,
  remaining integer,
  cached_detector_score numeric,
  cached_label text,
  cached_model_name text,
  cached_model_version text,
  cached_reasons jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cache_row public.score_cache;
  reviewer_row public.reviewers;
  bucket_row public.rate_limit_buckets;
  effective_tier text := coalesce(p_tier, 'public_guest');
  effective_quota integer := greatest(coalesce(p_public_quota, 1), 0);
  now_value timestamptz := now();
begin
  select * into cache_row
  from public.score_cache
  where score_cache.content_key = p_content_key
    and (score_cache.expires_at is null or score_cache.expires_at > now_value);

  if found then
    insert into public.rate_limit_events (subject_key, content_key, tier, decision, metadata)
    values (
      coalesce(p_subject_key, 'anonymous'),
      p_content_key,
      effective_tier,
      'cache_hit',
      jsonb_build_object('platform', p_platform)
    );

    return query select
      'cache_hit'::text,
      false,
      null::integer,
      cache_row.detector_score,
      cache_row.label,
      cache_row.model_name,
      cache_row.model_version,
      cache_row.reasons;
    return;
  end if;

  select * into reviewer_row
  from public.reviewers
  where reviewers.reviewer_id = p_subject_key;

  if found then
    effective_tier := reviewer_row.tier;
  end if;

  if effective_tier = 'owner_admin' or coalesce(reviewer_row.owner_bypass, false) then
    insert into public.rate_limit_events (subject_key, content_key, tier, decision, metadata)
    values (
      coalesce(p_subject_key, 'anonymous'),
      p_content_key,
      'owner_admin',
      'owner_bypass',
      jsonb_build_object('platform', p_platform)
    );

    return query select
      'owner_bypass'::text,
      true,
      999999::integer,
      null::numeric,
      null::text,
      null::text,
      null::text,
      null::jsonb;
    return;
  end if;

  select * into bucket_row
  from public.rate_limit_buckets
  where subject_key = coalesce(p_subject_key, 'anonymous')
    and window_end > now_value;

  if not found then
    insert into public.rate_limit_buckets (
      subject_key,
      tier,
      window_start,
      window_end,
      used,
      quota,
      updated_at
    )
    values (
      coalesce(p_subject_key, 'anonymous'),
      effective_tier,
      now_value,
      now_value + interval '24 hours',
      0,
      effective_quota,
      now_value
    )
    on conflict (subject_key) do update set
      tier = excluded.tier,
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      used = 0,
      quota = excluded.quota,
      updated_at = now_value
    returning * into bucket_row;
  end if;

  if bucket_row.used < bucket_row.quota then
    update public.rate_limit_buckets
    set used = used + 1,
        updated_at = now_value
    where subject_key = bucket_row.subject_key
    returning * into bucket_row;

    insert into public.rate_limit_events (subject_key, content_key, tier, decision, metadata)
    values (
      bucket_row.subject_key,
      p_content_key,
      effective_tier,
      'live_allowed',
      jsonb_build_object('platform', p_platform, 'used', bucket_row.used, 'quota', bucket_row.quota)
    );

    return query select
      'live_allowed'::text,
      true,
      greatest(bucket_row.quota - bucket_row.used, 0),
      null::numeric,
      null::text,
      null::text,
      null::text,
      null::jsonb;
    return;
  end if;

  insert into public.rate_limit_events (subject_key, content_key, tier, decision, metadata)
  values (
    bucket_row.subject_key,
    p_content_key,
    effective_tier,
    'rate_limited',
    jsonb_build_object('platform', p_platform, 'used', bucket_row.used, 'quota', bucket_row.quota)
  );

  return query select
    'rate_limited'::text,
    false,
    0::integer,
    null::numeric,
    null::text,
    null::text,
    null::text,
    null::jsonb;
end;
$$;

create or replace function public.record_score_cache(
  p_content_key text,
  p_platform text,
  p_detector_score numeric,
  p_evidence_coverage numeric,
  p_label text,
  p_model_name text default null,
  p_model_version text default null,
  p_reasons jsonb default '[]'::jsonb,
  p_ttl_seconds integer default 2592000
)
returns public.score_cache
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_cache public.score_cache;
begin
  insert into public.score_cache (
    content_key,
    platform,
    detector_score,
    evidence_coverage,
    label,
    model_name,
    model_version,
    reasons,
    expires_at,
    updated_at
  )
  values (
    p_content_key,
    p_platform,
    p_detector_score,
    coalesce(p_evidence_coverage, 0),
    p_label,
    p_model_name,
    p_model_version,
    coalesce(p_reasons, '[]'::jsonb),
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 2592000), 0)),
    now()
  )
  on conflict (content_key) do update set
    platform = excluded.platform,
    detector_score = excluded.detector_score,
    evidence_coverage = excluded.evidence_coverage,
    label = excluded.label,
    model_name = excluded.model_name,
    model_version = excluded.model_version,
    reasons = excluded.reasons,
    expires_at = excluded.expires_at,
    updated_at = now()
  returning * into saved_cache;

  insert into public.verdict_history (
    content_key,
    event_type,
    label,
    detector_score,
    metadata
  )
  values (
    p_content_key,
    'detector_score_cached',
    p_label,
    p_detector_score,
    jsonb_build_object('model_name', p_model_name, 'model_version', p_model_version)
  );

  return saved_cache;
end;
$$;

create or replace function public.prepare_benchmark_batch(
  p_limit integer default 100,
  p_min_votes integer default 1
)
returns table (
  batch_id uuid,
  inserted_examples integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_batch_id uuid;
  inserted_count integer;
begin
  insert into public.dataset_batches (status, candidate_count, cleaning_report)
  values ('cleaning', 0, jsonb_build_object('source', 'prepare_benchmark_batch'))
  returning id into new_batch_id;

  with candidates as (
    select
      c.content_key,
      c.platform,
      public.clean_benchmark_text(c.text_snapshot) as cleaned_text,
      a.community_score,
      a.vote_count,
      sc.detector_score,
      sc.model_name,
      sc.model_version,
      case
        when a.community_score >= 75 then 'looks_ai'
        when a.community_score <= 25 then 'looks_human'
        else 'unsure'
      end as label
    from public.content_items c
    join public.community_aggregates a on a.content_key = c.content_key
    left join public.score_cache sc on sc.content_key = c.content_key
    where c.platform = 'x'
      and c.text_snapshot is not null
      and length(public.clean_benchmark_text(c.text_snapshot)) >= 30
      and a.vote_count >= greatest(coalesce(p_min_votes, 1), 1)
    order by a.updated_at desc nulls last
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  ),
  inserted as (
    insert into public.benchmark_examples (
      content_key_hash,
      source_platform,
      cleaned_text,
      label,
      community_score,
      vote_count,
      detector_score,
      model_name,
      model_version,
      pii_cleaned,
      public_exportable
    )
    select
      md5(content_key),
      platform,
      cleaned_text,
      label,
      community_score,
      vote_count,
      detector_score,
      model_name,
      model_version,
      true,
      true
    from candidates
    on conflict (content_key_hash) do update set
      cleaned_text = excluded.cleaned_text,
      label = excluded.label,
      community_score = excluded.community_score,
      vote_count = excluded.vote_count,
      detector_score = excluded.detector_score,
      model_name = excluded.model_name,
      model_version = excluded.model_version,
      pii_cleaned = true,
      public_exportable = true
    returning id
  )
  select count(*)::integer into inserted_count from inserted;

  update public.dataset_batches
  set status = 'ready',
      candidate_count = inserted_count,
      cleaning_report = jsonb_build_object(
        'pii_cleaned', true,
        'public_exportable', true,
        'source_platform', 'x'
      )
  where id = new_batch_id;

  return query select new_batch_id, inserted_count;
end;
$$;

create or replace function public.list_public_benchmark_examples(p_limit integer default 100)
returns table (
  content_key_hash text,
  source_platform text,
  cleaned_text text,
  label text,
  community_score numeric,
  vote_count integer,
  detector_score numeric,
  model_name text,
  model_version text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    content_key_hash,
    source_platform,
    cleaned_text,
    label,
    community_score,
    vote_count,
    detector_score,
    model_name,
    model_version,
    created_at
  from public.benchmark_examples
  where public_exportable = true
    and pii_cleaned = true
  order by created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon;
    grant execute on function public.get_community_aggregate(text) to anon;
    grant execute on function public.submit_community_vote(text, text, text, text, text, text, text, text, text, text) to anon;
    grant execute on function public.submit_appeal(text, text, text, text) to anon;
    grant execute on function public.get_verdict_history(text, integer) to anon;
    grant execute on function public.resolve_score_plan(text, text, text, text, integer) to anon;
    grant execute on function public.record_score_cache(text, text, numeric, numeric, text, text, text, jsonb, integer) to anon;
    grant execute on function public.prepare_benchmark_batch(integer, integer) to anon;
    grant execute on function public.list_public_benchmark_examples(integer) to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
  end if;
end $$;

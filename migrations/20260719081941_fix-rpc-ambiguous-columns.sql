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
  on conflict on constraint reviewers_pkey do update set updated_at = now();

  select r.quality_weight into weight
  from public.reviewers r
  where r.reviewer_id = p_reviewer_id;

  insert into public.community_votes (
    content_key,
    reviewer_id,
    vote,
    reviewer_weight,
    updated_at
  )
  values (p_content_key, p_reviewer_id, p_vote, coalesce(weight, 0.25), now())
  on conflict on constraint community_votes_content_key_reviewer_id_key do update set
    vote = excluded.vote,
    reviewer_weight = excluded.reviewer_weight,
    updated_at = now()
  returning * into saved_vote;

  update public.reviewers r
  set review_count = (
    select count(*)::integer
    from public.community_votes cv
    where cv.reviewer_id = p_reviewer_id
  ),
  updated_at = now()
  where r.reviewer_id = p_reviewer_id;

  insert into public.training_candidates (content_key, source_event, label, cleaning_status, pii_risk, metadata)
  values (
    p_content_key,
    'vote',
    p_vote,
    'pending',
    case when nullif(p_text_snapshot, '') is null then 'unknown' else 'medium' end,
    jsonb_build_object('platform', p_platform)
  )
  on conflict on constraint training_candidates_content_key_source_event_key do update set
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
    agg.community_score,
    jsonb_build_object('vote', p_vote, 'reviewer_weight', coalesce(weight, 0.25))
  from public.get_community_aggregate(p_content_key) agg;

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
  on conflict on constraint reviewers_pkey do update set updated_at = now();

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
  on conflict on constraint training_candidates_content_key_source_event_key do update set
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

-- Slop Frog training-data layer.
--
-- This file is intentionally separate from schema.sql so the demo community
-- tables can stay stable while the training pipeline evolves.
--
-- Privacy rule: raw post text, author handles, profile data, and post URLs do
-- not belong in the public training dataset. The only publishable training rows
-- are rows that passed the cleaner and were explicitly marked public.

create extension if not exists pgcrypto;

create table if not exists public.training_label_queue (
  id uuid primary key default gen_random_uuid(),
  content_key text not null references public.content_items(content_key) on delete cascade,
  platform text not null check (platform in ('x')),
  source_post_id text not null,
  source_url text,
  community_score numeric check (community_score is null or (community_score >= 0 and community_score <= 100)),
  vote_count integer not null default 0 check (vote_count >= 0),
  reviewer_weight_sum numeric not null default 0 check (reviewer_weight_sum >= 0),
  status text not null default 'queued'
    check (status in ('queued', 'fetched', 'cleaned', 'blocked', 'published')),
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_key)
);

create table if not exists public.training_clean_examples (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  platform text not null check (platform in ('x')),

  -- Stable hashes allow dedupe without exposing tweet IDs or URLs.
  content_key_hash text not null,
  source_post_id_hash text not null,
  content_fingerprint text not null,

  cleaned_text text not null,
  target_label text not null check (target_label in ('ai_generated', 'human_written')),
  label_score numeric not null check (label_score >= 0 and label_score <= 100),
  label_source text not null default 'community_weighted'
    check (label_source in ('community_weighted', 'appeal_resolved', 'manual_review')),

  vote_count integer not null default 0 check (vote_count >= 0),
  reviewer_weight_sum numeric not null default 0 check (reviewer_weight_sum >= 0),
  detector_score numeric check (detector_score is null or (detector_score >= 0 and detector_score <= 100)),
  slop_score numeric check (slop_score is null or (slop_score >= 0 and slop_score <= 100)),

  redaction_report jsonb not null default '{}'::jsonb,
  pii_status text not null default 'clean' check (pii_status in ('clean', 'blocked', 'needs_review')),
  is_public boolean not null default false,
  collected_at timestamptz,
  cleaned_at timestamptz not null default now(),
  published_at timestamptz,

  constraint training_clean_examples_no_raw_urls
    check (cleaned_text !~* '(https?://|www\\.)'),
  constraint training_clean_examples_no_emails
    check (cleaned_text !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}'),
  constraint training_clean_examples_no_handles
    check (cleaned_text !~* '(^|[^A-Za-z0-9_])@[A-Za-z0-9_]{2,}'),
  constraint training_clean_examples_no_phone_like_numbers
    check (cleaned_text !~* '(\\+?[0-9][0-9 .()\\-]{7,}[0-9])'),
  constraint training_clean_examples_public_only_when_clean
    check (is_public = false or pii_status = 'clean'),
  unique (content_fingerprint)
);

create table if not exists public.training_dataset_exports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  example_count integer not null check (example_count >= 0),
  manifest jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.training_data_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_name text,
  requester_contact text,
  intended_use text not null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'fulfilled')),
  export_id uuid references public.training_dataset_exports(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create or replace view public.training_ingest_candidates as
select
  ci.content_key,
  ci.platform,
  ci.tweet_id as source_post_id,
  ci.url as source_url,
  ca.weighted_ai_score as community_score,
  ca.vote_count,
  (ca.looks_ai_weight + ca.looks_human_weight + ca.unsure_weight) as reviewer_weight_sum,
  ca.updated_at
from public.content_items ci
join public.community_aggregates ca on ca.content_key = ci.content_key
where ci.platform = 'x'
  and ci.tweet_id is not null
  and ca.vote_count >= 2
  and ca.weighted_ai_score is not null
  and ca.weighted_ai_score not between 35 and 65;

create or replace view public.public_training_dataset as
select
  schema_version,
  platform,
  content_fingerprint,
  cleaned_text,
  target_label,
  label_score,
  label_source,
  vote_count,
  reviewer_weight_sum,
  detector_score,
  slop_score,
  redaction_report,
  collected_at,
  cleaned_at,
  published_at
from public.training_clean_examples
where is_public = true
  and pii_status = 'clean';

# Slop Frog Training Data Pipeline

This folder prepares community-labeled X posts for future detector improvement.

The pipeline is intentionally local-first and privacy-first:

- The database stores community labels and safe metadata.
- A local authorized fetch step rehydrates the actual X post text.
- The cleaner removes direct identifiers and blocks risky examples.
- Only cleaned, PII-free examples can be exported or marked public.
- Raw X text should stay in a local `.local/` folder and should not be committed.

## What this does

1. Take post IDs that users already labeled through Slop Frog.
2. Fetch the current post text through an authorized X API token.
3. Join that text with community scores/reviewer weights.
4. Redact direct identifiers: URLs, handles, emails, phone numbers, addresses, cards, SSNs, wallet-like strings, and similar patterns.
5. Drop ambiguous rows instead of pretending the cleaner is perfect.
6. Write a JSONL training dataset with no raw post ID, URL, handle, or author profile.
7. Optionally publish only rows marked `pii_status = clean`.

## What this does not do

- It does not bypass X access controls.
- It does not scrape logged-in browser pages.
- It does not store media files.
- It does not publish raw X URLs, tweet IDs, author handles, profile fields, emails, phone numbers, or unredacted text.
- It does not train the detector yet.

## Supabase setup

Apply the normal community schema first:

```bash
supabase db push
```

Or paste these files into the Supabase SQL editor in this order:

1. `supabase/schema.sql`
2. `supabase/training_schema.sql`

The training schema adds:

- `training_label_queue`
- `training_clean_examples`
- `training_dataset_exports`
- `training_data_access_requests`
- `training_ingest_candidates`
- `public_training_dataset`

`public_training_dataset` exposes only cleaned rows that were explicitly marked public.

## Environment

Optional for fetching X content:

```bash
X_BEARER_TOKEN=YOUR_X_API_BEARER_TOKEN
```

Never commit this token.

## Workflow

Create a local folder for temporary raw data:

```bash
mkdir .local
```

Export candidate labels from Supabase using the `training_ingest_candidates` view.
Save the output as JSONL like:

```json
{"content_key":"x:123","platform":"x","source_post_id":"123","community_score":92,"vote_count":4,"reviewer_weight_sum":2.5}
```

Fetch actual post text from X with an authorized bearer token:

```bash
node training-data/src/x-api-fetcher.mjs \
  --labels .local/community-labels.jsonl \
  --out .local/x-posts.jsonl
```

Clean and join the fetched content with labels:

```bash
node training-data/src/prepare-training-dataset.mjs \
  --content .local/x-posts.jsonl \
  --labels .local/community-labels.jsonl \
  --out .local/clean-training.jsonl
```

Export a public-safe dataset file:

```bash
node training-data/src/export-public-dataset.mjs \
  --in .local/clean-training.jsonl \
  --out .local/public-training.jsonl \
  --manifest .local/public-training-manifest.json
```

## Label mapping

For now, the cleaner uses conservative binary labels:

- `community_score >= 75` → `ai_generated`
- `community_score <= 25` → `human_written`
- anything in the middle is skipped

This keeps the first training set cleaner and avoids training on community disagreement.

## Public release rule

A row can be public only if:

- `pii_status` is `clean`;
- the text passed all redaction checks;
- no raw X post ID, URL, handle, author ID, or profile field is included;
- the dataset manifest records the cleaner version and export date.

If in doubt, block the row. A smaller clean dataset is better than a big messy one.

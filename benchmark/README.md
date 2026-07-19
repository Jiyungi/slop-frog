# Slop Frog Public Benchmark

The benchmark goal is a privacy-cleaned dataset of explicitly labeled social posts that can help evaluate or train future AI-content detectors.

The source of truth is InsForge, not a committed JSON file. Export files are generated locally into `benchmark/exports/` and ignored by git so we do not accidentally publish user data before review.

## What can enter the benchmark

A row can be exported only when:

- it came from explicit user action, such as a community vote or appeal;
- the backend cleaning status is `cleaned`;
- the backend marks it `public_exportable`;
- the cleaned text is non-empty;
- the source platform is supported by the MVP: `x` or `linkedin`.

Passive scrolling must not create benchmark examples.

## Fields

Each exported example contains:

```json
{
  "source_platform": "x",
  "content_key_hash": "privacy-preserving-hash",
  "cleaned_text": "Public cleaned text...",
  "label": "looks_ai",
  "community_score": 100,
  "vote_count": 3,
  "exported_at": "2026-07-19T00:00:00.000Z"
}
```

No raw handles, profile names, emails, phone numbers, URLs, raw post IDs, or raw media are exported.

## Export

Dry run:

```powershell
node benchmark/export-public-benchmark.mjs --limit 25 --dry-run
```

Write an ignored export artifact:

```powershell
node benchmark/export-public-benchmark.mjs --limit 100 --out benchmark/exports/slop-frog-public-benchmark.json
```

The script calls InsForge RPCs:

- `prepare_benchmark_batch`
- `list_public_benchmark_examples`

It then applies a final local sanitization pass before printing or writing JSON.

## Why this is not “scraping LinkedIn”

The MVP does not run a backend LinkedIn scraper. It uses text already visible in the user’s browser when the user explicitly labels or appeals a post. That keeps the learning loop tied to user intent instead of silently collecting feeds.

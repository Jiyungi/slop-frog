# Slop Frog Supabase

Schema and setup notes for community labels, reviewer reputation, appeals, and verdict history.

## Environment Contract

The extension/community layer expects these values during local development:

- `SLOP_FROG_SUPABASE_URL`: Supabase project URL, for example `https://YOUR_PROJECT_ID.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable API key
- `SLOP_FROG_DEMO_REVIEWER_ID`: local demo reviewer identity, for example `demo-reviewer-local`

Do not commit real secret values. Copy `.env.example` into a local environment file when wiring Supabase.

## Community vote RPC

`schema.sql` exposes `submit_community_vote` as the only public write path for
the MVP. It upserts the content item, creates a first-time reviewer at the
low default weight, and inserts or updates that reviewer's one vote for the
content item. The database—not the caller—chooses the reviewer weight.

Run this live verification after applying the schema:

```sh
/opt/homebrew/bin/node supabase/dev/verify-vote.mjs
```

Appeals use the separate `submit_appeal` RPC and preserve the submitted status:

```sh
/opt/homebrew/bin/node supabase/dev/verify-appeal.mjs
```

Each vote and appeal writes an immutable verdict-history event automatically.
Use the generic score/label change helper directly with:

```sh
/opt/homebrew/bin/node supabase/dev/verify-history.mjs
```

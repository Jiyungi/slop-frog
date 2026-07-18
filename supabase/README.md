# Slop Frog Supabase

Schema and setup notes for community labels, reviewer reputation, appeals, and verdict history.

## Environment Contract

The extension/community layer expects these values during local development:

- `SLOP_FROG_SUPABASE_URL`: Supabase project URL, for example `https://YOUR_PROJECT_ID.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable API key
- `SLOP_FROG_DEMO_REVIEWER_ID`: local demo reviewer identity, for example `demo-reviewer-local`

Do not commit real secret values. Copy `.env.example` into a local environment file when wiring Supabase.

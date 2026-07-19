# Future Training Pipeline (Inactive for MVP)

Slop Frog’s MVP has no backend data-collection or model-training pipeline.
The local detector runs the pinned Imbue model on the user’s laptop; Supabase
stores only explicit community actions and associated metadata.

The following are intentionally inactive and must not be added to an MVP code
path:

- backend scraping, timeline crawling, or automatic collection of X posts;
- post rehydration from X/Twitter APIs;
- scheduled jobs, cron jobs, queues, or webhooks that fetch social content;
- automatic model training, fine-tuning, evaluation, or weight deployment.

For a future, consent-based training workflow, the team could export
explicitly submitted community labels, appeal outcomes, immutable verdict
history, and the minimal permitted content metadata. Any such work must first
address platform terms, user consent, retention, privacy, dataset governance,
and a separate model-evaluation plan. It is not implemented or scheduled here.

# Slop Frog Demo Script

Use branch `modal-imbue-inference`.

## 0. Preflight

Run these before opening the browser:

```powershell
git branch --show-current
node extension/dev/configure-product-api-from-env.mjs
curl.exe https://YOUR-MODAL-ENDPOINT.modal.run/health
$env:SLOP_FROG_VERIFY_RUNTYPE='1'; node extension/dev/verify-product-api.mjs
node benchmark/export-public-benchmark.mjs --limit 5 --dry-run
```

Expected:

- branch is `modal-imbue-inference`;
- Modal health is OK;
- Runtype `score_post` returns a detector-backed score;
- InsForge votes, appeals, quota/cache, verdict history, benchmark export, and eval-gated promotion checks pass.

## 1. Install extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the repo’s `extension/` folder.
5. Open the Slop Frog popup.

Say:

> Slop Frog is a feed safety layer. Normal users do not paste content into a detector. They install the extension and scroll.

Show:

- Detector status.
- Runtype status.
- Community status.
- Quota status.
- Slop Score toggle.
- Auto-filter toggle off by default.

## 2. X feed

Open X.

Show:

- compact flag, feedback, and appeal buttons on posts;
- red/yellow/green/gray flag meaning;
- evidence panel with Slop Score, detector score, community score, modality rows, gray reason when present, and honest history graphs;
- feedback panel as a separate button;
- appeal panel as a separate button.

Say:

> The visible flag is intentionally simple. Details are available, but the feed is not flooded with probabilities.

## 3. Community correction

On a flagged post:

1. Click feedback.
2. Vote `Looks human` or `Looks AI`.
3. Reopen evidence.

Show:

- community score updates;
- flag color updates when the Slop Score crosses a threshold;
- score history is preserved.

Say:

> The label is contestable. The system does not claim perfect truth.

## 4. Appeal

On the same or another post:

1. Click appeal.
2. Choose `Missing context` or `Human-written`.
3. Reopen evidence if needed.

Say:

> Appeals matter because AI detectors can be wrong. A safety tool should never be an unchallengeable accusation machine.

## 5. Auto-filter opt-in

1. Open popup.
2. Enable auto-filter.
3. Return to the feed.
4. Show a red post collapsed.
5. Click show.
6. Disable auto-filter.
7. Confirm blockers disappear.

Say:

> Filtering is user-controlled and off by default. Slop Frog gives agency instead of silently controlling the feed.

## 6. LinkedIn

Open LinkedIn feed.

Show:

- flags render on LinkedIn posts;
- same evidence/feedback/appeal model.

Say:

> Platforms are adapters. X and LinkedIn are the MVP targets; the scoring and backend contracts are shared.

## 7. Benchmark and learning loop

Run:

```powershell
node benchmark/export-public-benchmark.mjs --limit 5 --dry-run
```

Show:

- cleaned benchmark examples;
- `content_key_hash`, not raw post IDs;
- no raw media;
- no passive-feed export.

Say:

> The long-term loop is detector flags content, humans correct it, explicit labels become cleaned benchmark data, and future detector versions must pass evals plus human approval before promotion.

## 8. Safety close

End with:

> Slop Frog is necessary because synthetic content is now cheap and abundant. Users deserve a lightweight layer that helps them understand what they are consuming, challenge bad labels, and reduce exposure to AI slop without giving platforms total control over truth.

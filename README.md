# Slop Frog

Slop Frog catches AI slop in your feed.

Let's be honest: social media is not stopping AI slop from flooding people's feeds. It reaches children, parents, and grandparents before they even know what they are looking at. Slop Frog gives users a simple safety layer while they scroll.

Slop Frog is a Chrome extension for X and LinkedIn that flags likely AI-generated content directly inside the feed. Users do not copy and paste posts into a detector. They scroll normally, and Slop Frog adds a small red, yellow, green, or gray flag beside supported posts.

## Demo download

The packaged demo extension is available here:

https://drive.google.com/drive/folders/114rvqYgrSMPz-4yAWEM757UlT04pypMX?usp=drive_link

For the free demo install path:

1. Download the zip.
2. Unzip it.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped Slop Frog extension folder.
7. Open X and scroll.

## What users see

- A small flag on supported X and LinkedIn posts.
- A separate feedback button for community votes.
- A separate appeal button when a label seems wrong.
- A compact evidence panel with the Slop Score, detector score, community score, modality rows, gray reason, and score history when available.
- Optional auto-filtering for red posts. It is off by default.

Flag meaning:

- **Red:** high Slop Score.
- **Yellow:** medium Slop Score.
- **Green:** low Slop Score.
- **Gray:** not enough signal, unsupported content, quota exhausted, or workflow unavailable.

Gray is not "human." Gray means Slop Frog is admitting uncertainty.

## Why this matters

AI-generated content is becoming cheap, persuasive, and extremely scalable. Most platforms still do not clearly label it. That creates safety risks:

- spam and engagement farming;
- scams and impersonation;
- political astroturfing;
- low-quality synthetic content crowding out human posts;
- children and older users consuming synthetic content without context.

Slop Frog does not claim that a model is always right. It is intentionally contestable: users can inspect evidence, vote when a label looks wrong, and appeal bad labels.

## How scoring works

Slop Frog combines three signals:

1. **Detector score**
   - The current MVP uses an Imbue-released Qwen-based AI text detector inspired by Imbue's Bouncer work.
   - Modal hosts the detector so normal users do not need to download model weights or run a large model locally.

2. **Community judgment**
   - Users can vote whether a post looks AI-generated, human-written, or uncertain.
   - Community feedback is stored as explicit labels, not passive surveillance.

3. **Slop Score**
   - Slop Frog combines the detector signal and community feedback into one simple score.
   - The UI shows a flag instead of overwhelming users with raw probabilities.

## How we use sponsor tools

### Modal

Modal is the hosted inference layer.

Local inference was too heavy for a normal laptop demo. Modal lets Slop Frog run the Imbue/Qwen detector on hosted compute and return a score to the extension. This makes the extension usable without asking every user to install a model locally.

### InsForge

InsForge is the backend database and product state layer.

Slop Frog uses InsForge for:

- community votes;
- appeals;
- score cache;
- verdict history;
- reviewer/reputation records;
- rate-limit buckets;
- benchmark and training-data candidate records.

InsForge is what makes Slop Frog collaborative instead of just a local toy detector.

### Runtype

Runtype is the workflow and orchestration layer.

For each scoring request, Runtype can:

1. receive the post payload from the extension;
2. check InsForge for a cached score;
3. check the user's quota;
4. call Modal only when live inference is allowed;
5. save the result back to InsForge;
6. combine detector and community signals;
7. return the Slop Score and flag state to the extension.

For feedback and appeals, Runtype routes user actions into InsForge and updates the product's evidence trail. Longer term, Runtype can manage evals, cleaned benchmark exports, and model-improvement workflows.

In one sentence: **Modal runs the detector, InsForge stores the community and product data, and Runtype coordinates the scoring and feedback workflow.**

## Privacy and data minimization

Slop Frog does not need to store everyone's entire feed.

The backend stores explicit votes, appeals, post identifiers, scores, and limited metadata. For future model improvement, labeled examples must be cleaned before public export or training use. The benchmark pipeline removes obvious emails, phone numbers, handles, URLs, and extra whitespace before examples are marked public-exportable.

No raw images, audio, or video are stored in the MVP.

## Public rate limits

Public users should not be able to burn unlimited hosted inference.

Default policy:

- Public users get **15 new uncached live inferences per rolling 24 hours**.
- Cached scores and community signals can still be shown after quota is exhausted.
- If there is no cached/community signal, the post becomes gray with a rate-limit reason.
- Owner/admin bypass is for demos and development only and is not included in public-share builds.

## Architecture

```text
Chrome extension
  -> extracts visible post text from X/LinkedIn
  -> renders flags, evidence, feedback, appeals, and optional auto-filtering
  -> calls the Slop Frog product API

Runtype
  -> orchestrates score, feedback, appeal, quota, cache, and future eval workflows

InsForge
  -> stores votes, appeals, score cache, rate limits, verdict history, and benchmark candidates

Modal
  -> runs hosted Imbue/Qwen text-detector inference
```

The stable public path is:

```text
Extension -> Runtype -> InsForge quota/cache -> Modal only when allowed
```

## Local setup

Create `.env` from `.env.example` and fill in real values:

```text
SLOP_FROG_DEMO_REVIEWER_ID=public-share-user
SLOP_FROG_PUBLIC_QUOTA=15
SLOP_FROG_ALLOW_DIRECT_DETECTOR_FALLBACK=false
SLOP_FROG_MODAL_DETECTOR_URL=https://YOUR-MODAL-ENDPOINT.modal.run

INSFORGE_BACKEND_URL=https://YOUR_APPKEY.us-east.insforge.app
INSFORGE_ANON_KEY=YOUR_INSFORGE_ANON_KEY

RUNTYPE_PRODUCT_ID=YOUR_RUNTYPE_PRODUCT_ID
RUNTYPE_SURFACE_ID=YOUR_RUNTYPE_SURFACE_ID
RUNTYPE_SCORE_POST_URL=YOUR_RUNTYPE_SCORE_POST_ENDPOINT
RUNTYPE_SUBMIT_FEEDBACK_URL=YOUR_RUNTYPE_FEEDBACK_ENDPOINT
RUNTYPE_SUBMIT_APPEAL_URL=YOUR_RUNTYPE_APPEAL_ENDPOINT
RUNTYPE_PRODUCT_API_KEY=YOUR_RUNTYPE_PRODUCT_API_KEY
```

Generate the ignored local extension config:

```powershell
node extension/dev/configure-product-api-from-env.mjs
```

Load the extension:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click **Load unpacked**.
4. Select the repo's `extension/` directory.
5. Open X or LinkedIn and scroll.

## Verification

```powershell
node --check extension/src/shared/product-api.mjs
node --check extension/src/background/index.js
node extension/dev/verify-product-api.mjs
node extension/dev/verify-extension-contracts.mjs
node modal-detector/verify-modal-contract.mjs
node benchmark/export-public-benchmark.mjs --limit 25 --dry-run
```

## Benchmark goal

The long-term goal is a privacy-cleaned benchmark from explicit labels on real social content. Other detector models should be able to train or evaluate against it later.

The benchmark is not created by scraping everyone's feed. It is created from posts users explicitly label or appeal, cleaned to reduce PII, marked public-exportable, and exported through the benchmark tooling.

See [benchmark/README.md](benchmark/README.md).

For the demo flow, see [docs/demo-script.md](docs/demo-script.md).

## MVP limits

- The current detector is text-first.
- Image, audio, and video rows are shown honestly as unsupported or MVP text-first until real multimodal detectors are integrated.
- LinkedIn backend scraping is out of scope. The extension can analyze text visible in the user's browser.
- Public-share builds should not include owner/admin bypass.
- Chrome Web Store release still needs final policy review, production Runtype key, and production rate-limit hardening.

# Slop Frog

Let’s be honest: social media is not stopping AI slop from flooding people’s feeds. It reaches children, parents, and grandparents before they even know what they are looking at. Slop Frog exists to give users a simple safety layer while they scroll.

Slop Frog is a Chrome extension for X and LinkedIn that flags likely AI-generated content directly inside the feed. Instead of making users copy and paste posts into a detector, Slop Frog works automatically while they scroll and shows a simple red, yellow, green, or gray flag on each supported post.

## What users see

- A small colored flag beside each supported post.
- A feedback button for “looks AI,” “looks human,” or “unsure.”
- An appeal button when a label seems wrong.
- A compact evidence panel with Slop Score, detector score, community score, modality rows, gray reason, and real history graphs when history exists.
- Optional auto-filtering for red posts. It is off by default.

Flag meaning:

- Red: high Slop Score.
- Yellow: mixed or medium Slop Score.
- Green: low Slop Score.
- Gray: not enough signal, unsupported content, quota exhausted, or detector/workflow unavailable.

Gray is not “human.” It is Slop Frog admitting uncertainty.

## Why this is an AI safety project

This project serves the safety themes of information integrity, user protection, transparency, and human oversight. AI-generated content is becoming cheap, persuasive, and extremely scalable, but most platforms do not clearly label it. That creates real risks: manipulation, spam, low-quality engagement farming, scams, political astroturfing, and vulnerable users being exposed to synthetic content without context.

Slop Frog does not claim “this is definitely AI.” It shows evidence, allows community correction, and supports appeals because detectors can make mistakes and safety tools should not become unchallengeable accusation machines.

## How Slop Frog scores a post

Slop Frog combines three signals:

1. **Detector score**  
   Modal hosts the Imbue-released Qwen-based AI text detector used in the Bouncer direction.

2. **Community judgment**  
   Users can vote whether content looks AI-generated, human-written, or uncertain.

3. **Slop Score**  
   The product combines detector signal and community feedback into one simple score, then displays a clear flag instead of overwhelming users with raw probabilities.

## Current architecture

```text
Chrome extension
  -> extracts visible X/LinkedIn post text in the browser
  -> asks the Slop Frog product API for a score
  -> renders flag, evidence, feedback, appeal, and optional auto-filter UI

Runtype
  -> product workflow layer for score_post, feedback, appeal,
     training-batch preparation, and eval gates

InsForge
  -> backend database for votes, appeals, reviewer quality, score cache,
     rate limits, verdict history, benchmark examples, and model/eval records

Modal
  -> hosted Imbue/Qwen text-detector inference
```

During debugging, the extension can fall back to calling Modal directly. The public product path should go through Runtype/InsForge first so cache and rate limits can control Modal cost.

## Privacy and data minimization

Slop Frog does not need to store everyone’s entire feed. The backend stores explicit community votes, appeals, post identifiers, scores, and limited metadata. Training candidates are created from explicit labels, not passive scrolling.

For future model improvement, labeled examples must be cleaned before public export or training use. The benchmark path removes obvious emails, phone numbers, handles, URLs, and extra whitespace, and only exports rows that the backend marks as cleaned and public-exportable.

No raw images, audio, or video are stored in the MVP.

## Public rate limits

The long-term product is a Chrome Web Store extension normal people can install. Public users should not be able to burn unlimited Modal inference.

Default policy:

- Public users get one new uncached live inference per rolling 24 hours.
- Cached scores and community signals can still be shown after quota is exhausted.
- If there is no cached/community signal, the post becomes gray with a rate-limit reason.
- Owner/admin users can bypass public limits for demos and development.

## Setup

Prerequisites:

- Chrome
- Node.js
- Python 3.12+
- Modal CLI account
- InsForge CLI account linked to the `slop_frog` project
- Runtype product/API key if using the Runtype workflow path

Create `.env` from `.env.example` and fill in real values:

```text
SLOP_FROG_DEMO_REVIEWER_ID=demo-reviewer-local
SLOP_FROG_OWNER_REVIEWER_ID=demo-reviewer-local
SLOP_FROG_PUBLIC_QUOTA=1
SLOP_FROG_ALLOW_DIRECT_DETECTOR_FALLBACK=true
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

To create the working Runtype feedback and appeal endpoints for this product, run:

```bash
node runtype/setup-slop-frog-actions.mjs --write-env
```

This creates `submit_feedback_insforge` and `submit_appeal_insforge` flows, exposes them on the Runtype API surface, and updates the local `.env` endpoint URLs without writing secrets into the repo.

Generate the extension’s ignored local config:

```powershell
node extension/dev/configure-product-api-from-env.mjs
```

Deploy or verify Modal:

```powershell
python -m modal deploy modal-detector/slop_frog_modal.py
curl.exe https://YOUR-MODAL-ENDPOINT.modal.run/health
```

Load the extension:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click **Load unpacked**.
4. Select this repo’s `extension/` directory.
5. Open X or LinkedIn and scroll.

## Verification

Static/product checks:

```powershell
node --check extension/src/shared/product-api.mjs
node --check extension/src/background/index.js
node extension/dev/verify-product-api.mjs
node extension/dev/verify-extension-contracts.mjs
```

Chrome extension load check:

```powershell
$env:CHROME_BINARY='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:SLOP_FROG_VERIFY_OFFLINE='1'
node extension/dev/verify-loaded-extension.mjs
```

Synthetic X/LinkedIn feed check:

```powershell
$env:CHROME_BINARY='C:\Program Files\Google\Chrome\Application\chrome.exe'
node extension/dev/verify-feed-injection.mjs
```

Modal detector check:

```powershell
node modal-detector/verify-modal-contract.mjs
```

Benchmark export check:

```powershell
node benchmark/export-public-benchmark.mjs --limit 25 --dry-run
```

## Benchmark goal

The final dataset goal is a privacy-cleaned benchmark from explicit labels on X and LinkedIn content. Other detector models should be able to train or evaluate against it later.

The benchmark is not created by scraping everyone’s feed. It is created from posts users explicitly label or appeal, cleaned to reduce PII, marked public-exportable, and exported through the benchmark tooling.

See [benchmark/README.md](benchmark/README.md).

For presentation flow, see [docs/demo-script.md](docs/demo-script.md).

## MVP limits

- The current detector is text-first. Image/audio/video rows are shown honestly as unsupported or MVP text-first until real multimodal detectors are integrated.
- LinkedIn backend scraping is out of scope. The extension can analyze text visible in the user’s browser.
- Runtype scoring, feedback, and appeal workflows must return real non-placeholder responses before they are marked production-ready. Empty Runtype verdicts fail safe into the fallback path.
- Chrome Web Store release still needs final policy review, production Runtype key, and production rate-limit hardening.

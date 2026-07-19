# Slop Frog

Slop Frog is a local-first Chrome extension for X and LinkedIn. It extracts the
visible feed posts in the browser, scores their text with the local Imbue
Qwen detector on the Mac, and stores explicit community feedback and appeals
in Supabase. X/Twitter and LinkedIn are the only supported sources in this MVP.

## Local setup

Prerequisites: Chrome, Python 3.12+, Node.js, and an Apple Silicon Mac with
MPS available for local model inference. You also need an authenticated
Supabase CLI linked to the intended Slop Frog project.

1. Create a local `.env` from `.env.example` and supply the Supabase URL,
   publishable key, and demo reviewer ID. Do not commit `.env`.

2. Apply the checked-in schema to the linked Supabase project:

   ```sh
   env PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/npx supabase db query --linked --file supabase/schema.sql --debug
   ```

3. Generate the extension's ignored local Supabase configuration:

   ```sh
   node extension/dev/configure-supabase-from-env.mjs
   ```

4. Install the detector dependencies and ensure the pinned local Imbue model
   assets are present under `local-detector/models/imbue/`. The exact base
   model and adapter revisions are documented in [local-detector/MODELS.md](local-detector/MODELS.md).

   ```sh
   python3 -m venv local-detector/.venv
   local-detector/.venv/bin/pip install -r local-detector/requirements.txt
   ```

5. Start the detector in one terminal. It loads and warms the model before
   health becomes ready; that avoids the first scored post paying the Metal
   compilation cost.

   ```sh
   cd local-detector
   .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765
   ```

   Confirm `http://localhost:8765/health` reports `model_loaded: true`.

6. In Chrome, open `chrome://extensions`, turn on Developer mode, choose
   **Load unpacked**, and select the repository's `extension/` directory.
   The popup should show the local endpoint, detector status, and Supabase
   connection. Open X or LinkedIn and scroll a feed to see the compact flag,
   feedback, and appeal controls.

## Verification

With the detector stopped, this confirms the extension loads in Chrome, the
popup is wired to Supabase, persisted settings work, and a missing detector
becomes a gray result:

```sh
SLOP_FROG_VERIFY_OFFLINE=1 node extension/dev/verify-loaded-extension.mjs
```

With the detector running, this validates the real extension background worker,
local Qwen scores, cache behavior, LinkedIn envelope support, Supabase vote,
and appeal RPCs:

```sh
SLOP_FROG_EXPECT_DETECTOR=connected \
SLOP_FROG_VERIFY_SCORE=1 \
SLOP_FROG_VERIFY_SUPABASE=1 \
node extension/dev/verify-loaded-extension.mjs
```

This uses Chrome's supported DevTools loading path for current branded Chrome
releases. To exercise the actual content script against synthetic X and
LinkedIn feed pages (including flags, auto-filter, evidence charts, feedback,
appeal, malformed extraction, and scroll stability), keep the detector running
and run:

```sh
node extension/dev/verify-feed-injection.mjs
```

For quick static contract checks and local detector unit tests:

```sh
node extension/dev/verify-person-a.mjs
local-detector/.venv/bin/python -m unittest discover -s local-detector/tests -v
```

## MVP limits

- The detector runs locally; there is no backend feed scraping, rehydration,
  scheduled job, or training pipeline.
- Supabase accepts only explicit feedback and appeals from the extension.
- Reddit, Facebook, and other social networks are not supported.

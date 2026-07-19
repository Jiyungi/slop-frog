# Slop Frog Modal Imbue Detector

This branch adds a hosted GPU inference path for the Imbue Qwen detector.

Use this when the MacBook local detector runs out of RAM or is too slow for the
demo. Modal runs the same text detector contract behind:

- `GET /health`
- `POST /score`

The Chrome extension can keep using the normal detector client. The only change
is that `SLOP_FROG_MODAL_DETECTOR_URL` points the extension at the Modal URL
instead of `http://localhost:8765`.

## Why Modal

The Imbue Qwen detector is built on `Qwen/Qwen3-4B` plus
`DarrenJiaImbue/ai-detection-demo-qwen_3_4b`. On a MacBook Air this can be too
large for comfortable local inference. Modal gives us an NVIDIA GPU and a
persistent Hugging Face cache volume.

## Authenticate Modal

You already added these to `.env`:

```sh
MODAL_TOKEN_ID=...
MODAL_TOKEN_SECRET=...
```

Run:

```sh
node modal-detector/setup-modal-auth.mjs
```

This runs Modal's official token setup command without printing your token.

## Deploy

```sh
python -m modal deploy modal-detector/slop_frog_modal.py
```

Modal will print a public `https://...modal.run` URL. Copy that full URL into
`.env`:

```sh
SLOP_FROG_MODAL_DETECTOR_URL=https://YOUR-ENDPOINT.modal.run
```

Then regenerate the ignored extension config:

```sh
node extension/dev/configure-supabase-from-env.mjs
```

Reload the Chrome extension in `chrome://extensions`.

## Warm it before the demo

The Modal deployment keeps one container warm for the demo:

- `min_containers=1` keeps a GPU container alive instead of scaling to zero.
- `max_containers=1` prevents a request burst from creating several containers
  that each load their own Qwen copy.
- `@modal.concurrent(max_inputs=1)` serializes requests through the warm model.
- `scaledown_window=1800` gives extra idle time if the warm-container setting is
  changed later.

This costs more than scale-to-zero, but it avoids repeated model reloads during
judging.

The first request after deploy can still download/load the model. Before
demoing, open:

```sh
curl https://YOUR-ENDPOINT.modal.run/health
```

Wait until it returns:

```json
{"status":"ok","model_loaded":true}
```

After that, the warm container should keep serving without reloading unless the
deployment is restarted or Modal has to replace the container.

## GPU choice

Default GPU is `L4`, which is usually enough for a 4B bfloat16 detector and is
cheaper than A100/H100. If it OOMs, set:

```sh
SLOP_FROG_MODAL_GPU=A10
```

or:

```sh
SLOP_FROG_MODAL_GPU=L40S
```

and redeploy.

## Verification

Static contract check:

```sh
node modal-detector/verify-modal-contract.mjs
```

With the Modal URL in `.env` and the extension config regenerated, the popup
should show the Modal endpoint and eventually report detector connected.

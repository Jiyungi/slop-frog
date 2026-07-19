# Slop Frog Local Detector

Local laptop inference service for the Chrome extension.

The MVP service listens on `http://localhost:8765`.

## Run on an Apple Silicon Mac

From this directory:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765
```

Startup loads the pinned local Qwen3-4B base model plus Imbue detector adapter
from `models/imbue/`; it never downloads model weights at runtime. The service
uses PyTorch MPS with bfloat16 because float16 produces non-finite Qwen logits
on this runtime. See [MODELS.md](MODELS.md) for the exact revisions and license.

Verify it in another terminal:

```sh
curl http://localhost:8765/health
```

`GET /health` reports `model_loaded: true` only after the local model has loaded
and completed its one-time Apple Metal warmup. A valid `POST /score` request
with at least 20 words then receives the Imbue Qwen four-bucket expected-value
score converted to the shared 0–100 scale. Shorter text remains gray with
`not_enough_signal`.

## Shared constants

- Local detector URL: `http://localhost:8765`
- Red threshold: `75`
- Yellow threshold: `40`
- Evidence coverage minimum: `50`

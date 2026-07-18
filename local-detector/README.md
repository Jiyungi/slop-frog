# Slop Frog Local Detector

Local laptop inference service for the Chrome extension.

The MVP service listens on `http://localhost:8765`.

## Run the scaffold

From this directory:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765
```

Verify it in another terminal:

```sh
curl http://localhost:8765/health
```

The initial scaffold exposes health only. Request validation and local scoring
are implemented in subsequent Person B subtasks.

## Shared constants

- Local detector URL: `http://localhost:8765`
- Red threshold: `75`
- Yellow threshold: `40`
- Evidence coverage minimum: `50`

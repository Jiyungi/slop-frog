# Slop Frog Extension

Chrome extension MVP for labeling X and LinkedIn feed posts while the user
scrolls. These are the only supported sources for this sprint; it does not
support Reddit, Facebook, or other social networks yet.

Implementation lives under `src/`.

## Demo fixture

Open `extension/dev/x-feed-fixture.html` in Chrome to see the in-feed controls
against three local X-style posts with mocked detector responses.

This fixture is not the final demo. It is a quick UI sanity check before loading
the unpacked extension on X.

## Verification

Run:

```bash
node extension/dev/verify-extension-contracts.mjs
```

The script checks manifest references, scoped permissions, Slop Score thresholds,
gray handling, and separation between evidence, feedback, and appeal panels.

For product API checks against InsForge and the configured scoring path:

```bash
node extension/dev/verify-product-api.mjs
```

For synthetic X and LinkedIn feed injection:

```bash
node extension/dev/verify-feed-injection.mjs
```

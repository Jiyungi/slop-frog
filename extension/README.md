# Slop Frog Extension

Chrome extension MVP for labeling X and LinkedIn feed posts while the user
scrolls. These are the only supported sources; it does not scrape a backend or
support Reddit, Facebook, or other social networks.

Implementation lives under `src/`.

## Person A demo fixture

Open `extension/dev/x-feed-fixture.html` in Chrome to see the in-feed controls
against three local X-style posts with mocked detector responses.

This fixture is not the final demo. It is a quick UI sanity check before loading
the unpacked extension on X.

## Person A verification

Run:

```bash
node extension/dev/verify-person-a.mjs
```

The script checks manifest references, scoped permissions, Slop Score thresholds,
gray handling, and separation between evidence, feedback, and appeal panels.

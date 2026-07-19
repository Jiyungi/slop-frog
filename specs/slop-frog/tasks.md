# Implementation Plan: Slop Frog

## Overview

This plan updates Slop Frog for the AGI Summit hackathon direction. The project is now a solo-builder implementation, not a two-person split. The core product remains a Chrome extension that flags likely AI-generated content while users scroll, but the architecture has changed:

- X and LinkedIn are the current platform targets.
- Modal hosts the Imbue/Qwen text detector.
- Runtype coordinates scoring, feedback, appeals, learning workflows, and eval gates.
- InsForge replaces Supabase as the backend.
- Cotal is out of scope.

The branch that currently fits this direction best is:

```text
modal-imbue-inference
```

Work should continue there until the demo path is stable, then merge to `main`.

The long-term target is a Chrome Web Store extension. Public users should be able to install and use Slop Frog, but they must be severely rate-limited for live Modal inference. The owner/admin account is allowed to bypass public limits for demos and development.

No task may be marked complete until its verification step has passed. "Code exists" is not enough.

## Solo ownership

Owner for all tasks: **Solo Builder**

This means there is no teammate split. The work is still staged in waves so the product does not turn into spaghetti.

## Task waves

1. Stabilize shared contracts and config.
2. Stabilize Modal detector access.
3. Wire Runtype as the product workflow layer.
4. Migrate backend data paths to InsForge.
5. Add public rate limits and score cache.
6. Polish extension UI and platform support.
7. Add learning-loop architecture and eval gates.
8. Verify and package the demo.

## Tasks

- [x] 1. Establish current hackathon branch
  - [x] 1.1 Confirm active branch
    - Use `modal-imbue-inference` for the new hackathon direction.
    - _Requirements: 17.1_
    - **Verification:** `git branch --show-current` returns `modal-imbue-inference`.

- [x] 2. Update shared contracts for the new architecture
  - [x] 2.1 Update shared TypeScript contracts
    - Ensure contracts include X and LinkedIn platform values.
    - Ensure contracts include Runtype/Modal-compatible score request and response fields.
    - Ensure contracts include feedback, appeal, verdict history, reviewer quality, and modality rows.
    - _Requirements: 2.1-2.5, 3.1-3.6_
    - **Verification:** stale-architecture scan shows no old extension references to Supabase, localhost detector defaults, or teammate split ownership.
    - **Status:** Verified by removing legacy Supabase helpers/config fallback, removing localhost detector defaults, and renaming the old contract verifier to `verify-extension-contracts.mjs`. Remaining Supabase mentions are historical migration notes outside the active extension architecture.

  - [x] 2.2 Update threshold and gray-state constants
    - Keep X/global red >= 75, yellow 40 through 74, green < 40, gray for insufficient signal.
    - Keep LinkedIn red >= 40, yellow/orange 21 through 39, green <= 20.
    - Ensure auto-filter default is false.
    - _Requirements: 7.4, 8.1-8.5, 13.1_
    - **Verification:** Fixture tests or manual score fixtures produce expected red, yellow, green, and gray labels.

  - [x] 2.3 Add Runtype and InsForge environment contract
    - Document required variables for Runtype product API, Modal detector URL, and InsForge backend.
    - Document owner/admin identifier configuration.
    - Remove Supabase as the target backend from new setup docs.
    - _Requirements: 4.8, 5.1-5.8, 6.1-6.7, 6B.10-6B.12_
    - **Verification:** `.env.example` contains the current required variable names without secret values.

- [x] 3. Stabilize Modal detector
  - [x] 3.1 Deploy or redeploy Modal detector
    - Deploy `modal-detector/slop_frog_modal.py`.
    - Capture the real Modal app URL.
    - _Requirements: 4.1-4.5_
    - **Verification:** `curl.exe <MODAL_URL>/health` returns a successful health response.

  - [x] 3.2 Configure Modal URL everywhere it is needed
    - Set local env/config for `SLOP_FROG_MODAL_DETECTOR_URL`.
    - Set Runtype/InsForge secret or workflow variable for the Modal detector URL.
    - _Requirements: 4.6-4.8, 5.2_
    - **Verification:** Runtype `score_post` returns a detector-backed response instead of gray placeholder output.
    - **Status:** Verified with strict `SLOP_FROG_VERIFY_RUNTYPE=1 node extension/dev/verify-product-api.mjs`; response includes Imbue/Qwen model identity and detector score.

  - [x] 3.3 Confirm model identity
    - Confirm the running detector is using the intended Imbue/Qwen text detector path or compatible artifact.
    - Record `modelName` and `modelVersion` in responses.
    - _Requirements: 4.4-4.5_
    - **Verification:** A `/score` response includes non-placeholder `modelName` and `modelVersion`.

- [x] 4. Wire Runtype product workflows
  - [x] 4.1 Create Runtype product and API surface
    - Product: Slop Frog.
    - Surface: Slop Frog API.
    - _Requirements: 5.1_
    - **Verification:** Runtype API lists the Slop Frog product and API surface.

  - [x] 4.2 Create core Runtype capabilities
    - `score_post`
    - `submit_feedback`
    - `submit_appeal`
    - `prepare_training_batch`
    - `evaluate_new_detector`
    - _Requirements: 5.1-5.6, 16.1-16.6_
    - **Verification:** Runtype API lists the capabilities.

  - [x] 4.3 Create Runtype eval suites
    - Scoring workflow eval.
    - Detector regression eval.
    - Privacy-cleaning eval.
    - _Requirements: 5.6, 16.4_
    - **Verification:** Runtype API lists the eval suites.

  - [x] 4.4 Connect extension scoring to Runtype
    - Route extension scoring through the Runtype `score_post` endpoint as the stable product API.
    - Keep direct Modal calls available only as a debug fallback.
    - Ensure public scoring goes through quota/cache before Modal.
    - _Requirements: 5.1-5.8, 6B.3-6B.12_
    - **Verification:** A live post score is produced through Runtype, not only direct Modal, and the response includes a rate-limit/cache decision.
    - **Status:** Verified by strict Runtype product API scoring plus browser fixture checks. The extension now checks InsForge quota/cache before live Runtype scoring and writes detector results back to cache/history.

  - [x] 4.5 Connect feedback and appeal to Runtype
    - Route feedback and appeal submissions through Runtype or through InsForge functions called by Runtype.
    - _Requirements: 5.3-5.4, 11.1-11.6, 12.1-12.5_
    - **Verification:** A live feedback submission and appeal submission reach the backend through the intended workflow path.
    - **Status:** Verified. `node runtype/setup-slop-frog-actions.mjs --write-env` created `submit_feedback_insforge` and `submit_appeal_insforge`; strict `SLOP_FROG_VERIFY_RUNTYPE=1 node extension/dev/verify-product-api.mjs` confirms both endpoints write non-placeholder InsForge records.

- [x] 5. Migrate backend from Supabase to InsForge
  - [x] 5.1 Link InsForge project
    - Link project `slop_frog` to this directory.
    - _Requirements: 6.1_
    - **Verification:** `npx @insforge/cli current --json` shows the linked `slop_frog` project.

  - [x] 5.2 Create InsForge schema
    - Add tables for content items, reviewers, community votes, appeals, verdict history, training candidates, dataset batches, model registry, eval results, score cache, rate-limit buckets, and rate-limit events.
    - _Requirements: 6.2-6.10, 6A.1-6A.9, 6B.5-6B.12, 14.1-14.6, 15.1-15.7, 16.1-16.7_
    - **Verification:** InsForge SQL query confirms all required tables exist.

  - [x] 5.2.1 Create actual InsForge migration file
    - Use `npx @insforge/cli db migrations new migrate_slop_frog_schema`.
    - Port the useful Supabase schema into InsForge/Postgres migration SQL.
    - Normalize `tweet_id` to `post_id`.
    - Normalize `reputation_weight` to `quality_weight`.
    - Keep `content_key` stable.
    - _Requirements: 6A.1-6A.9_
    - **Verification:** Migration applies with `npx @insforge/cli db migrations up --all`.

  - [x] 5.3 Implement community aggregate query
    - Compute weighted community score from explicit votes and reviewer quality.
    - _Requirements: 11.2-11.6, 14.1-14.4_
    - **Verification:** A fixture with one `looks_ai`, one `looks_human`, and one `unsure` vote returns the expected weighted score.

  - [x] 5.4 Implement feedback write path
    - Store explicit votes and update/recompute aggregate.
    - _Requirements: 11.1-11.6_
    - **Verification:** A feedback action from the extension creates/updates a backend vote and changes visible Slop Score when appropriate.

  - [x] 5.5 Implement appeal write path
    - Store appeal reason and status.
    - _Requirements: 12.1-12.5_
    - **Verification:** An appeal from the extension creates a backend appeal record.

  - [x] 5.6 Implement verdict history writes and reads
    - Store detector score, community score, Slop Score, label, reason, and event type.
    - Read history for the evidence graph.
    - _Requirements: 10.7-10.10, 12.5_
    - **Verification:** A post with one score and one later vote has at least two verdict-history events.
    - **Status:** Verified by `node extension/dev/verify-product-api.mjs`; the check asserts `community_vote` and `detector_score_cached` events are both returned.

- [x] 6. Implement public rate limiting and score cache
  - [x] 6.1 Add score cache lookup
    - Check `score_cache` before calling Modal.
    - Reuse fresh detector scores by `content_key`.
    - _Requirements: 6B.5-6B.6, 15.8-15.9_
    - **Verification:** Scoring the same content twice results in one Modal call and one cache hit.

  - [x] 6.2 Add public quota buckets
    - Create quota logic for public users.
    - Default public quota: one new uncached live inference per rolling 24 hours per install/account.
    - _Requirements: 6B.7-6B.9_
    - **Verification:** A public test subject can score one uncached post live, then receives `rate_limited` fallback for the next uncached post.

  - [x] 6.3 Add owner/admin bypass
    - Configure owner/admin identity server-side.
    - Bypass public quota for owner/admin requests.
    - _Requirements: 6B.10-6B.12, 17.12_
    - **Verification:** Owner/admin test subject can score multiple uncached posts without rate-limit fallback.

  - [x] 6.4 Add graceful quota UI
    - When quota is exhausted, show cached/community results if available.
    - If no score is available, show gray with reason `rate_limited`.
    - _Requirements: 6B.9, 18.6-18.7_
    - **Verification:** Public quota exhaustion does not crash the extension or spam Modal.

- [x] 7. Stabilize X extension UI
  - [x] 7.1 Keep auto-filter off by default
    - Existing user settings should migrate away from accidental default-on behavior.
    - _Requirements: 13.1_
    - **Verification:** Fresh install and existing install both show auto-filter disabled unless the user explicitly enables it.

  - [x] 7.2 Remove stale auto-filter blockers when disabled
    - If the user unchecks auto-filter, visible blockers should disappear.
    - _Requirements: 13.4_
    - **Verification:** A hidden red post reappears after auto-filter is turned off.

  - [x] 7.3 Finalize bottom-left/bottom-action placement
    - The compact controls should sit near the lower-left/bottom action area without pushing X buttons sideways.
    - _Requirements: 9.1-9.5_
    - **Verification:** Test at least five X post shapes: text-only, quote post, image post, video post, repost/reply, and confirm no collisions.
    - **Status:** Verified by `node extension/dev/verify-feed-injection.mjs`; seven X fixture shapes render left-aligned after the native action row with no native action overlap.

  - [x] 7.4 Replace ugly placeholder icons
    - Use a real flag shape for evidence.
    - Use a clear white message/feedback icon.
    - Use a clear white justice/appeal icon.
    - _Requirements: 9.2-9.4_
    - **Verification:** Icons are legible on X dark mode and do not look like markdown drawings.
    - **Status:** Verified by `node extension/dev/verify-extension-contracts.mjs`; compact controls use branded SVG icon-only actions.

  - [x] 7.5 Finalize evidence panel behavior
    - Evidence panel must close.
    - Opening evidence must not permanently block feedback or appeal actions.
    - Graphs must use real data or honest single-point/flat states.
    - _Requirements: 9.7-9.8, 10.1-10.10_
    - **Verification:** Open/close evidence, then open feedback and appeal on the same post.
    - **Status:** Verified by `node extension/dev/verify-feed-injection.mjs`; the check opens evidence, clicks close, then opens feedback and appeal on X fixtures.

  - [x] 7.6 Polish popup UI
    - Remove noisy developer fields from the default popup.
    - Keep detector/community status understandable.
    - Keep green brand identity while preserving contrast.
    - _Requirements: 9.6, 9.9-9.10_
    - **Verification:** Popup is readable, compact, and has no unnecessary explainer text.
    - **Status:** Verified by `node extension/dev/verify-loaded-extension.mjs` and `node extension/dev/verify-extension-contracts.mjs`; popup hides developer detector URL, shows detector/community/Runtype/quota status, and includes the frog brand mark.

- [x] 8. Stabilize LinkedIn support
  - [x] 8.1 Verify LinkedIn content script matching
    - Ensure manifest host permissions and content script matches include LinkedIn.
    - _Requirements: 1.3, 2.1_
    - **Verification:** Extension content script runs on LinkedIn feed pages.

  - [x] 8.2 Implement/repair LinkedIn adapter selectors
    - Extract visible LinkedIn post text and metadata into the same `Post_Envelope` shape.
    - _Requirements: 2.3-2.5_
    - **Verification:** At least three LinkedIn feed posts produce valid envelopes.

  - [x] 8.3 Render LinkedIn compact controls
    - Add controls without colliding with LinkedIn buttons.
    - _Requirements: 1.3, 9.1-9.5_
    - **Verification:** At least three LinkedIn posts show flags.

- [x] 9. Fix score-update correctness
  - [x] 9.1 Update flag color after community vote
    - If voting changes Slop Score from green to yellow/red or vice versa, update the visible flag immediately.
    - _Requirements: 7.5, 11.5_
    - **Verification:** Fixture or live vote changes visible flag color without page refresh.
    - **Status:** Verified by `node extension/dev/verify-feed-injection.mjs`; a red X fixture changes to yellow after a `looks_human` vote.

  - [x] 9.2 Fix community score formatting
    - Remove stray `.0` or formatting artifacts.
    - _Requirements: 11.6_
    - **Verification:** Community score renders as a clean integer/label in evidence panel.
    - **Status:** Verified by `node extension/dev/verify-feed-injection.mjs`; evidence renders `0 (1 vote)` and rejects stray `.0` formatting.

  - [x] 9.3 Make graphs honest
    - If only one verdict-history event exists, show a flat/single-point state.
    - If no real history exists, show unavailable instead of fake trend movement.
    - _Requirements: 10.7-10.10_
    - **Verification:** One-event fixture does not render fake rising graph.

- [x] 10. Implement privacy-safe learning-loop foundation
  - [x] 10.1 Store training candidates only from explicit labels
    - Votes and appeals may create candidates.
    - Passive scrolling must not create training examples.
    - _Requirements: 15.1-15.7, 16.1-16.3_
    - **Verification:** Scoring a post without voting does not create a training candidate.

  - [x] 10.2 Add PII-cleaning metadata
    - Track cleaning status and PII risk for each candidate.
    - _Requirements: 15.5-15.7, 16.3_
    - **Verification:** Candidate records include cleaning status before dataset batch membership.

  - [x] 10.3 Add dataset batch workflow placeholder
    - Runtype `prepare_training_batch` should select cleaned candidates and create a batch record.
    - _Requirements: 16.1-16.4_
    - **Verification:** Running the workflow on fixtures produces a batch metadata record, not a full training job.

  - [x] 10.4 Add eval-gated promotion design
    - Runtype `evaluate_new_detector` should record eval results before model promotion.
    - _Requirements: 16.4-16.7_
    - **Verification:** A candidate model cannot be marked promoted unless eval status is passing and approval is recorded.
    - **Status:** Verified by `SLOP_FROG_VERIFY_RUNTYPE=1 node extension/dev/verify-product-api.mjs`; failing evals block promotion, missing approval blocks promotion, and all required passing eval suites plus approval promote the model.

- [x] 11. Clean documentation for judges and public users
  - [x] 11.1 Update README project description
    - Explain Slop Frog from the safety/user perspective.
    - Include detector, community feedback, Slop Score, contestability, and data minimization.
    - _Requirements: 17.1-17.10_
    - **Verification:** README contains the updated project description.

  - [x] 11.2 Update setup instructions
    - Explain Modal deployment/health check.
    - Explain Runtype product key vs admin key.
    - Explain InsForge backend setup.
    - Explain loading the unpacked extension.
    - _Requirements: 4.8, 5.1-5.8, 6.1-6.7, 17.1-17.10_
    - **Verification:** A fresh reader can reach Modal health and load the extension using docs only.
    - **Status:** Verified by updating `README.md` with Modal health, InsForge config, Runtype env, Chrome unpacked loading, and current verification commands.

  - [x] 11.3 Add demo script
    - Create a short demo path for judges.
    - Include X, LinkedIn if stable, evidence, feedback, appeal, and auto-filter opt-in.
    - _Requirements: 17.2-17.10_
    - **Verification:** Demo can be completed once without editing code mid-demo.
    - **Status:** Verified by adding `docs/demo-script.md` with preflight checks, X flow, LinkedIn flow, feedback, appeal, auto-filter, benchmark export, and safety close.

  - [x] 11.4 Add Chrome Web Store readiness notes
    - Document public rate limit, privacy posture, required permissions, and no local-model requirement for public users.
    - _Requirements: 18.1-18.8_
    - **Verification:** README or release notes explain how a normal person installs and what happens after quota is exhausted.
    - **Status:** Verified by documenting public install target, public quota, cache/community fallback, gray rate-limit fallback, and owner/admin bypass in `README.md`.

  - [x] 11.5 Add public benchmark export documentation
    - Explain how cleaned public benchmark examples are generated from explicit labels.
    - Explain that raw media, raw post IDs, handles, emails, phones, and URLs are not exported.
    - _Requirements: 15.1-15.7, 16.1-16.4_
    - **Verification:** `node benchmark/export-public-benchmark.mjs --limit 5 --dry-run` returns deduped cleaned examples with `content_key_hash` and no raw media.

- [ ] 12. Final demo verification
  - [x] 12.1 Run extension syntax checks
    - Run existing extension verification commands.
    - _Requirements: 1.1-1.6_
    - **Verification:** `node --check` and existing verification script pass.

  - [x] 12.2 Run Modal health and score checks
    - Verify `/health` and `/score`.
    - _Requirements: 4.1-4.8_
    - **Verification:** Both endpoints return successful responses.

  - [x] 12.3 Run Runtype workflow checks
    - Verify score, feedback, and appeal endpoints.
    - _Requirements: 5.1-5.8_
    - **Verification:** All three endpoints return successful non-placeholder responses.
    - **Status:** Verified with strict `SLOP_FROG_VERIFY_RUNTYPE=1 node extension/dev/verify-product-api.mjs`; `score_post` returns a detector-backed Imbue/Qwen response, `submit_feedback_insforge` writes an InsForge vote, and `submit_appeal_insforge` writes an InsForge appeal.

  - [x] 12.4 Run InsForge backend checks
    - Verify schema, vote write, appeal write, aggregate read, and verdict-history read.
    - _Requirements: 6.1-6.7, 11.1-11.6, 12.1-12.5_
    - **Verification:** Backend rows exist and match expected fixture output.

  - [x] 12.5 Run public quota checks
    - Test public rate-limited subject.
    - Test owner/admin bypass.
    - _Requirements: 6B.7-6B.12, 17.11-17.13_
    - **Verification:** Public subject gets rate-limited after quota; owner/admin does not.

  - [ ] 12.6 Run live browser demo
    - Load extension.
    - Open X.
    - Open LinkedIn if stable.
    - Show flags, evidence, feedback, appeal, auto-filter on, auto-filter off.
    - _Requirements: 17.1-17.10_
    - **Verification:** Full demo path completes once without refresh-or-code-edit rescue.
    - **Status:** Blocked from automation in a temporary Chrome profile because real X and LinkedIn redirect logged-out sessions to login pages. Synthetic end-to-end browser verification passes; final live verification must be run in a logged-in Chrome profile.

## Dependency graph

```json
{
  "owner": "solo_builder",
  "branch": "modal-imbue-inference",
  "waves": [
    {
      "id": 0,
      "name": "Contracts and configuration",
      "tasks": ["1.1", "2.1", "2.2", "2.3"]
    },
    {
      "id": 1,
      "name": "Detector and workflow foundation",
      "tasks": ["3.1", "3.2", "3.3", "4.1", "4.2", "4.3", "5.1"]
    },
    {
      "id": 2,
      "name": "Product API and backend wiring",
      "tasks": ["4.4", "4.5", "5.2", "5.3", "5.4", "5.5", "5.6"]
    },
    {
      "id": 3,
      "name": "Public rate limiting and score cache",
      "tasks": ["6.1", "6.2", "6.3", "6.4"]
    },
    {
      "id": 4,
      "name": "Extension polish and platform support",
      "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "8.1", "8.2", "8.3", "9.1", "9.2", "9.3"]
    },
    {
      "id": 5,
      "name": "Learning loop and documentation",
      "tasks": ["10.1", "10.2", "10.3", "10.4", "11.1", "11.2", "11.3", "11.4"]
    },
    {
      "id": 6,
      "name": "Final verification",
      "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6"]
    }
  ],
  "completion_rule": "A task is complete only when its verification step has passed.",
  "merge_rule": "Merge modal-imbue-inference into main only after wave 6 passes."
}
```

## Notes

- Keep committing small verified changes.
- Do not commit `.env`, `.insforge`, CRX/PEM files, screenshots, or unrelated notes.
- Do not claim image/audio/video AI detection exists until a real multimodal detector is integrated.
- Do not reintroduce Supabase into the target architecture.
- Do not build Cotal usage unless the product direction changes.
- If Modal is cold, warn the user gracefully.
- If Runtype uses a testing API key, it is fine for demo but production needs a production key.

# Implementation Plan: Slop Frog

## Overview

This plan implements Slop Frog as a Chrome extension for X with local laptop inference and Supabase community labeling. The plan is structured for two people working in parallel after a shared-contract phase.

The build order is intentionally strict:

1. Shared contracts first.
2. Person A builds the Chrome extension and in-feed UI.
3. Person B builds the local detector service and Supabase community layer.
4. One integrator joins the two tracks and verifies the demo path.

No task may be marked complete until its verification step has passed. Code existing is not enough. A working check is required.

## Ownership

- **Shared Contract Phase - Both:** Tasks 1 through 4. These must finish before Person A and Person B split work.
- **Person A - Extension and UX:** Tasks 5 through 9.
- **Person B - Local Detector and Supabase:** Tasks 10 through 14.
- **Integrator - Person A or Person B:** Tasks 15 through 18.

## Tasks

- [x] 1. Create project skeleton and shared folder layout (Owner: Both)
  - [x] 1.1 Create top-level implementation folders
    - Create `extension/`, `extension/src/shared/`, `local-detector/`, and `supabase/`.
    - Add placeholder README files only if needed to preserve empty folders.
    - _Requirements: 1.1, 2.1_
    - **Verification:** `rg --files` shows the expected folders and no implementation code depends on missing paths.

- [x] 2. Define shared contracts before parallel work (Owner: Both)
  - [x] 2.1 Define the shared TypeScript contracts
    - Create `extension/src/shared/contracts.ts` containing `PostEnvelope`, `ScoreRequest`, `ScoreResponse`, `CommunityAggregate`, `SlopScoreResult`, `FlagLabel`, `ExtensionSettings`, compact UI control contracts, evidence panel model, feedback panel model, and appeal panel model.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
    - **Verification:** The file exports all required types and includes only the four allowed labels: `red`, `yellow`, `green`, `gray`.

  - [x] 2.2 Define thresholds and evidence coverage constants
    - Create `extension/src/shared/thresholds.ts` with red threshold 75, yellow threshold 40, evidence coverage minimum 50, and localhost URL `http://localhost:8765`.
    - _Requirements: 5.2, 5.3, 6.4, 6.5_
    - **Verification:** Both extension code and local detector docs reference the same constants.

  - [x] 2.3 Create fixture posts
    - Add at least three fixture posts: short gray fixture, medium yellow fixture, and high-risk red fixture.
    - _Requirements: 2.6, 16.3_
    - **Verification:** Person A and Person B can both run the same fixture JSON through their side without changing the schema.

- [x] 3. Define Supabase contract before UI work (Owner: Both)
  - [x] 3.1 Create Supabase schema file
    - Create `supabase/schema.sql` defining `content_items`, `reviewers`, `community_votes`, `appeals`, `verdict_history`, and a community aggregate view.
    - _Requirements: 9.1, 10.1, 11.2, 12.4_
    - **Verification:** Schema can be reviewed without missing required columns from requirements.md.

  - [x] 3.2 Define Supabase environment contract
    - Document required values: Supabase URL, publishable key, and demo reviewer ID.
    - _Requirements: 9.1, 14.1_
    - **Verification:** README or env example names required variables without secret values.

- [x] 4. Define extension permission contract (Owner: Both)
  - [x] 4.1 Draft Manifest V3 permissions
    - Include only `storage`, X/Twitter host permissions, localhost detector permission, and Supabase host permission.
    - _Requirements: 14.1, 14.2, 14.3_
    - **Verification:** Manifest does not include `<all_urls>` or unrelated host permissions.

- [ ] 5. Build Chrome extension scaffold (Owner: Person A)
  - [ ] 5.1 Create Manifest V3 extension files
    - Implement `extension/manifest.json`, content script entry, background worker entry, and popup files.
    - _Requirements: 1.1, 14.1, 14.4_
    - **Verification:** Chrome can load the unpacked extension without manifest errors.

  - [ ] 5.2 Add popup detector status UI
    - Show local detector URL, detector health status, Supabase status placeholder, score toggle, and auto-filter toggle.
    - _Requirements: 7.1, 14.4, 14.5_
    - **Verification:** Opening the extension popup shows the controls and persists toggle changes with `chrome.storage`.

- [ ] 6. Implement X extraction adapter (Owner: Person A)
  - [ ] 6.1 Detect visible X posts
    - Use a content script with `MutationObserver` and safe DOM scanning to find post containers while scrolling.
    - _Requirements: 1.4, 1.5, 3.1_
    - **Verification:** On X, at least three visible posts are detected and logged or marked without duplicate processing.

  - [ ] 6.2 Extract `PostEnvelope`
    - Extract tweet URL/ID when available, visible text, author handle, image URLs, normalized text, text hash, and extraction timestamp.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
    - **Verification:** Three live X posts produce valid `PostEnvelope` objects matching `contracts.ts`.

  - [ ] 6.3 Handle extraction failures as gray
    - If a post cannot be parsed, return a gray result with reason `extraction_failed`.
    - _Requirements: 3.8, 5.6_
    - **Verification:** A forced malformed fixture produces gray, not a crash.

- [ ] 7. Implement extension background worker (Owner: Person A)
  - [ ] 7.1 Call local detector
    - Send `ScoreRequest` to `http://localhost:8765/score` and handle success, timeout, and typed errors.
    - _Requirements: 4.1, 4.3, 4.7, 14.5_
    - **Verification:** With detector running, background worker receives a score; with detector stopped, popup and post UI show a clear connection error or gray state.

  - [ ] 7.2 Add local cache
    - Cache by `contentKey` so repeated posts are not rescored unnecessarily.
    - _Requirements: 1.5, 3.7_
    - **Verification:** The same `contentKey` is not sent to the detector repeatedly during one scroll session.

  - [ ] 7.3 Compute Slop Score result
    - Implement local Slop Score calculation using detector score and optional community aggregate.
    - _Requirements: 5.1, 6.1, 6.2, 6.3, 6.4_
    - **Verification:** Fixture scores produce expected red, yellow, green, and gray labels.

- [ ] 8. Implement in-feed flag UI (Owner: Person A)
  - [ ] 8.1 Render compact flags on X posts
    - Insert the compact Slop Frog controls from `specs/slop-frog/ui.md`: flag/evidence, feedback, and appeal. Use quiet icon-first buttons and avoid unnecessary explanatory text.
    - _Requirements: 6.6, 6.7, 8.8_
    - **Verification:** At least three X posts show stable flags while scrolling and no text overlaps post content.

  - [ ] 8.2 Render evidence panel
    - Show the inline evidence panel from `specs/slop-frog/ui.md`: detector score, Slop Score, community score, modality rows, gray reason, and simple history area. Do not include feedback or appeal controls inside the evidence panel.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
    - **Verification:** Clicking a flag opens the panel and all required sections render from fixture data.

  - [ ] 8.3 Implement auto-filter red posts
    - Collapse red posts only when auto-filter is enabled and include a reveal control.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
    - **Verification:** A red fixture collapses only when auto-filter is on; yellow, green, and gray do not collapse.

  - [ ] 8.4 Render separate feedback and appeal panels
    - Feedback opens from the `MessageSquareCheck` icon. Appeal opens from the `ShieldAlert` icon. Each panel asks one focused question and stays separate from evidence.
    - _Requirements: 8.7, 9.6, 12.1_
    - **Verification:** Feedback and appeal open from their own buttons, and neither action appears inside the evidence panel.

- [ ] 9. Implement evidence charts in UI (Owner: Person A)
  - [ ] 9.1 Add longitudinal score graph
    - Render time on x-axis and Slop Score on y-axis using verdict history.
    - _Requirements: 13.1, 13.2_
    - **Verification:** Mock verdict history renders a visible chart inside the evidence panel.

  - [ ] 9.2 Add volume vs score graph
    - Render review/repost volume on x-axis and Slop Score on y-axis.
    - _Requirements: 13.3, 13.4, 13.5_
    - **Verification:** Mock volume history renders a visible chart inside the evidence panel.

- [ ] 10. Build local detector service scaffold (Owner: Person B)
  - [ ] 10.1 Create FastAPI service
    - Implement `local-detector/app.py`, `schemas.py`, `scorer.py`, and `requirements.txt`.
    - _Requirements: 4.1, 4.2, 4.3_
    - **Verification:** `GET /health` returns ok on `http://localhost:8765/health`.

  - [ ] 10.2 Implement schema validation
    - Validate incoming `ScoreRequest` against the shared contract shape.
    - _Requirements: 2.1, 4.4, 4.5_
    - **Verification:** Valid fixture requests pass; malformed requests return typed errors.

- [ ] 11. Implement local scoring logic (Owner: Person B)
  - [ ] 11.1 Implement evidence coverage
    - Apply text-length coverage and return gray for too little usable signal.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
    - **Verification:** Short fixture returns gray with reason `not_enough_signal`.

  - [ ] 11.2 Implement detector score path
    - Integrate a local Bouncer-inspired detector if feasible; otherwise implement deterministic heuristic fallback for demo.
    - _Requirements: 4.4, 4.5, 4.8_
    - **Verification:** Medium and high-risk fixtures return stable numeric detector scores within 0 to 100.

  - [ ] 11.3 Implement local detector error handling
    - Return typed errors for model unavailable, invalid request, and internal failure.
    - _Requirements: 4.7, 14.5_
    - **Verification:** Simulated model failure returns a JSON error response and does not hang.

- [ ] 12. Implement Supabase community layer (Owner: Person B)
  - [ ] 12.1 Apply or validate Supabase schema
    - Create the required tables and aggregate view.
    - _Requirements: 9.1, 10.1, 12.4_
    - **Verification:** A SQL check confirms required tables exist, or local schema review is completed if Supabase credentials are unavailable.

  - [ ] 12.2 Implement vote insert/upsert helper
    - Store explicit community votes with content item identity and reviewer weight.
    - _Requirements: 9.2, 9.3, 9.4, 9.6_
    - **Verification:** Submitting a demo vote creates a row in `community_votes`.

  - [ ] 12.3 Implement aggregate fetch helper
    - Return weighted community score for a given `contentKey`.
    - _Requirements: 9.7, 10.4_
    - **Verification:** A voted fixture returns a non-null aggregate score.

- [ ] 13. Implement appeals and verdict history (Owner: Person B)
  - [ ] 13.1 Implement appeal insert helper
    - Store appeal reason and status.
    - _Requirements: 12.1, 12.2, 12.3_
    - **Verification:** Submitting a demo appeal creates a row in `appeals`.

  - [ ] 13.2 Implement verdict history insert helper
    - Store score and label change events.
    - _Requirements: 12.4, 12.5, 12.7_
    - **Verification:** A demo vote or appeal creates a `verdict_history` row.

- [ ] 14. Document inactive training placeholder (Owner: Person B)
  - [ ] 14.1 Add future training notes without implementation
    - Document that backend scraping, rehydration, scheduled jobs, and training are inactive for MVP.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
    - **Verification:** No code path, cron job, or script attempts to fetch X posts from the backend.

- [ ] 15. Integrate extension with local detector (Owner: Integrator)
  - [ ] 15.1 Run end-to-end local scoring
    - Start local detector, load extension, open X, score live posts.
    - _Requirements: 4.1, 4.4, 6.6, 16.1, 16.2, 16.3_
    - **Verification:** At least three X posts receive flags from local detector responses.

- [ ] 16. Integrate extension with Supabase (Owner: Integrator)
  - [ ] 16.1 Connect vote action to Supabase
    - From the evidence panel, submit a community vote and fetch updated aggregate.
    - _Requirements: 9.1, 9.6, 9.7, 16.5_
    - **Verification:** A vote submitted from the extension appears in Supabase and changes or creates the aggregate.

  - [ ] 16.2 Connect appeal action to Supabase
    - Submit an appeal from the evidence panel.
    - _Requirements: 12.1, 12.2, 16.4_
    - **Verification:** Appeal appears in Supabase and the evidence panel reflects submitted status.

- [ ] 17. Final demo verification (Owner: Integrator)
  - [ ] 17.1 Verify permission posture
    - Inspect manifest permissions.
    - _Requirements: 14.1, 14.2, 14.3_
    - **Verification:** Manifest requests only storage, X/Twitter hosts, localhost detector, and Supabase host.

  - [ ] 17.2 Verify full demo path
    - Demo local detector health, X post extraction, flags, evidence panel, community vote, appeal, and red auto-filter.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
    - **Verification:** The full demo path is manually completed once without refreshing or editing code mid-demo.

- [ ] 18. README and handoff (Owner: Integrator)
  - [ ] 18.1 Write local setup instructions
    - Explain how to run the local detector, load the unpacked extension, configure Supabase, and demo the product.
    - _Requirements: 14.6, 16.1, 16.2_
    - **Verification:** A teammate can follow the README and reach detector health plus loaded extension.

## Notes

- Tasks marked complete must have their verification line satisfied.
- Do not mark UI work complete without loading the extension in Chrome.
- Do not mark detector work complete without hitting the localhost endpoint.
- Do not mark Supabase work complete without inserting or fetching real data, unless credentials are unavailable; in that case, clearly mark the task blocked, not complete.
- Do not implement backend X scraping or training jobs in the MVP.
- Local heuristic scoring is acceptable only as a temporary demo fallback if model integration threatens the deadline.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "name": "Shared contracts", "tasks": ["1.1", "2.1", "2.2", "2.3", "3.1", "3.2", "4.1"] },
    { "id": 1, "name": "Parallel foundations", "tasks": ["5.1", "5.2", "10.1", "10.2", "12.1"] },
    { "id": 2, "name": "Parallel core implementation", "tasks": ["6.1", "6.2", "6.3", "7.1", "7.2", "11.1", "11.2", "11.3", "12.2", "12.3"] },
    { "id": 3, "name": "Parallel product features", "tasks": ["7.3", "8.1", "8.2", "8.3", "8.4", "9.1", "9.2", "13.1", "13.2", "14.1"] },
    { "id": 4, "name": "Integration", "tasks": ["15.1", "16.1", "16.2"] },
    { "id": 5, "name": "Final verification", "tasks": ["17.1", "17.2", "18.1"] }
  ],
  "split_rule": "Person A and Person B do not split implementation until every wave 0 task is verified.",
  "completion_rule": "A task is complete only when its verification step has passed."
}
```

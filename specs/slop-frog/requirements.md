# Requirements Document

## Introduction

Slop Frog is a Chrome extension for X and LinkedIn that flags likely AI-generated content directly inside the social feed. It is not a paste-in detector. The user scrolls normally; Slop Frog quietly annotates posts with a red, yellow, green, or gray flag, then lets the user open evidence, submit feedback, or appeal a label.

For the new AGI Summit hackathon direction, Slop Frog is an autonomous feed intelligence layer:

- the extension observes visible posts in the browser;
- Runtype orchestrates scoring, feedback, appeals, training workflows, and eval gates;
- Modal hosts the Imbue/Qwen text detector because local laptops did not have enough RAM for reliable demo inference;
- InsForge replaces Supabase as the backend for votes, appeals, verdict history, reviewer reputation, and cleaned training-data metadata;
- Cotal is intentionally out of scope.

The product serves the hackathon themes of AI-native products, autonomous workflows, AI infrastructure tools, and vertical AI applications for information integrity. The core safety belief is simple: social media feeds are already flooded with AI slop, but users do not get a lightweight way to understand, challenge, or reduce exposure to it.

The end product is not just a developer-mode demo. Slop Frog should become a Chrome Web Store extension that normal people can install and use. Public users must be rate-limited so they do not create uncontrolled Modal inference cost. The owner/admin account may bypass those public limits for demos, testing, and product development.

## Non-negotiable product rules

1. **No paste-in UX.** Slop Frog must work automatically while the user scrolls.
2. **One simple visible label.** The feed should show a compact flag, not a wall of probabilities.
3. **Gray is not green.** Gray means insufficient signal or scoring failure. Green means enough signal and low AI evidence.
4. **Actions are separate.** Evidence, feedback, and appeal are separate controls.
5. **Auto-filter is opt-in.** Slop Frog must never hide posts by default.
6. **No unnecessary text.** The UI should feel like a social app feature, not an AI-generated explainer panel.
7. **No raw media storage.** InsForge must not store raw images, audio, or video for the MVP.
8. **No backend LinkedIn scraping.** LinkedIn content can be analyzed when visible in the user's browser, but the backend must not scrape LinkedIn.
9. **No blind self-modifying model.** Future model improvement must be gated by cleaning, evals, and human approval before promotion.
10. **No public direct Modal calls.** Public extension users must call a controlled Slop Frog API that enforces cache, quota, and abuse limits before Modal inference.

## Glossary

- **Slop_Frog_System:** The Chrome extension, Runtype workflows, Modal detector, InsForge backend, and demo flow.
- **Supported_Platform:** `x` or `linkedin` for the current MVP scope.
- **Post_Envelope:** Normalized representation of a visible social post extracted by the extension.
- **Visible_Content:** Text and metadata visible to the user in the browser session.
- **Content_Key:** Stable post identity, preferably platform post ID; otherwise a normalized hash fallback.
- **Detector_Score:** 0 to 100 score from the hosted detector where higher means stronger AI evidence.
- **Slop_Score:** Final 0 to 100 score combining detector signal and community signal.
- **Community_Score:** Weighted community judgment score where looks-human is 0, unsure is 50, and looks-AI is 100.
- **Reviewer_Quality:** Weight assigned to a reviewer based on their history, starting low for new reviewers.
- **Evidence_Coverage:** Whether the system has enough usable signal to score responsibly.
- **Flag_Label:** One of `red`, `yellow`, `green`, or `gray`.
- **Evidence_Panel:** Compact panel showing the Slop Score, detector score, community score, modality rows, gray reason, and graphs.
- **Feedback_Panel:** Separate panel for community votes.
- **Appeal_Panel:** Separate panel for challenging a label.
- **Verdict_History:** Versioned record of score and label changes over time.
- **Training_Data_Candidate:** Explicitly labeled content candidate that may be cleaned and used later for detector improvement.
- **Runtype_Product:** The Slop Frog Runtype product/surface exposing scoring and workflow APIs.
- **Modal_Detector:** Hosted Imbue/Qwen detector endpoint on Modal.
- **InsForge_Backend:** Postgres-backed app backend replacing Supabase.
- **Public_User:** A normal Chrome Web Store user who is not the owner/admin.
- **Owner_User:** The project owner/admin account that can bypass demo and development rate limits.
- **Rate_Limit_Decision:** Backend decision saying whether a request can use live Modal inference, cached score only, community-only score, or gray fallback.

## Requirements

### Requirement 1: Chrome extension for X and LinkedIn

**User Story:** As a user scrolling social feeds, I want Slop Frog to work directly inside X and LinkedIn, so that I do not need to copy content into a separate detector.

#### Acceptance Criteria

1. THE Slop_Frog_System SHALL ship as a Chrome Extension using Manifest V3.
2. THE extension SHALL support X at `https://x.com/*` and `https://twitter.com/*`.
3. THE extension SHALL support LinkedIn feed pages at `https://www.linkedin.com/*`.
4. THE extension SHALL detect newly visible posts while the user scrolls.
5. THE extension SHALL NOT require paste-in detection for the core experience.
6. IF the user is on an unsupported site, THEN the extension SHALL not attempt feed extraction.

### Requirement 2: Platform adapters

**User Story:** As the product owner, I want each social platform isolated behind an adapter, so that Slop Frog can expand without rewriting the whole extension.

#### Acceptance Criteria

1. THE extension SHALL use a platform registry to select the active adapter.
2. THE X adapter SHALL extract visible post text, author handle when available, permalink when available, post ID when available, image URLs when available, and timestamp when available.
3. THE LinkedIn adapter SHALL extract visible post text, author identity when available, post URL when available, image URLs when available, and timestamp when available.
4. EACH adapter SHALL return the same `Post_Envelope` contract.
5. IF extraction is ambiguous or fails, THEN the adapter SHALL return a gray-compatible failure reason rather than throwing uncaught errors.

### Requirement 3: Shared contracts

**User Story:** As a solo builder moving fast, I want strict shared contracts, so that extension, backend, Runtype, and Modal integration do not drift.

#### Acceptance Criteria

1. THE repo SHALL define shared contracts for `Post_Envelope`, `Score_Request`, `Score_Response`, `Community_Aggregate`, `Slop_Score_Result`, `Feedback_Request`, `Appeal_Request`, and `Verdict_History_Event`.
2. THE allowed flag labels SHALL be exactly `red`, `yellow`, `green`, and `gray`.
3. THE scoring contract SHALL support text, image, audio, and video modality rows, even though the MVP detector is text-first.
4. THE contract SHALL identify unsupported media modalities as unsupported, not silently score them.
5. THE contract SHALL include `modelName`, `modelVersion`, and detector source metadata.
6. THE contract SHALL include fixture posts for gray, green, yellow, and red states.

### Requirement 4: Modal-hosted Imbue/Qwen detector

**User Story:** As a demo presenter, I want reliable hosted inference, so that scoring does not fail because a laptop runs out of RAM.

#### Acceptance Criteria

1. THE detector SHALL run on Modal for the new hackathon demo.
2. THE detector SHALL expose `GET /health`.
3. THE detector SHALL expose `POST /score`.
4. THE detector SHALL use the Imbue-released Qwen-based text detector path or compatible deployed artifact.
5. THE detector response SHALL include `detectorScore`, `evidenceCoverage`, `labelRecommendation`, `reasons`, `modelName`, and `modelVersion`.
6. IF Modal has cold-started, THEN the system SHALL show a graceful gray or loading state rather than crashing the page.
7. IF the detector is unavailable, THEN the extension SHALL keep working and label affected posts gray with a clear reason.
8. THE Modal detector URL SHALL be configured through environment/config, not hard-coded in multiple files.

### Requirement 5: Runtype orchestration

**User Story:** As a hackathon judge or maintainer, I want Runtype to coordinate the intelligent workflow, so that Slop Frog is more than a static extension calling a model.

#### Acceptance Criteria

1. THE Runtype product SHALL expose a `score_post` capability.
2. THE `score_post` workflow SHALL accept a `Score_Request`, call the Modal detector, and return a normalized `Score_Response`.
3. THE Runtype product SHALL expose a feedback capability; the current working endpoint is `submit_feedback_insforge`.
4. THE Runtype product SHALL expose an appeal capability; the current working endpoint is `submit_appeal_insforge`.
5. THE Runtype product SHALL include an agent or workflow for preparing cleaned learning batches from explicit labeled data.
6. THE Runtype product SHALL include eval suites for scoring workflow correctness, detector regression, and privacy-cleaning quality.
7. THE extension SHOULD call Runtype as the stable product API once the hackathon integration path is ready.
8. THE system MAY call Modal directly during debugging, but the intended product architecture SHALL place Runtype between the extension/backend and detector workflow.

### Requirement 6: InsForge backend

**User Story:** As the product owner, I want one backend for community data and app infrastructure, so that Slop Frog no longer depends on Supabase.

#### Acceptance Criteria

1. THE backend SHALL use InsForge, not Supabase, for the new hackathon direction.
2. THE InsForge backend SHALL store content items, explicit votes, reviewer profiles, appeals, verdict history, training candidates, cleaned dataset batches, model registry records, and eval results.
3. THE backend SHALL store post identifiers, source platform, score metadata, and explicit user labels.
4. THE backend SHALL NOT store raw private profiles, raw media files, or unnecessary personal identifiers.
5. THE backend SHALL support edge functions or API endpoints for feedback submission, appeal submission, aggregate lookup, and verdict-history lookup.
6. THE backend SHALL keep service keys server-side only.
7. THE extension SHALL use only publishable/app-safe configuration.
8. THE backend SHALL migrate the old Supabase-style schema into InsForge-owned migrations.
9. THE backend SHALL provide compatibility mapping from old Supabase table names and columns to the new InsForge schema where practical.
10. THE backend SHALL preserve the core entities: content items, reviewers, community votes, appeals, verdict history, and community aggregates.

### Requirement 6A: Supabase to InsForge migration

**User Story:** As the builder, I want a clear migration from Supabase to InsForge, so that the existing data model is not lost or duplicated in a messy way.

#### Acceptance Criteria

1. THE project SHALL keep the old Supabase schema as a reference only until migration is complete.
2. THE project SHALL create InsForge migration SQL that recreates the needed tables in InsForge/Postgres.
3. THE migration SHALL rename or normalize fields where useful, for example `reputation_weight` to `quality_weight`.
4. THE migration SHALL keep `content_key` as the stable cross-system identifier.
5. THE migration SHALL add rate-limit and score-cache tables required for public usage.
6. THE migration SHALL add training-candidate and dataset-batch tables for the future learning loop.
7. THE migration SHALL not copy secrets or service keys from Supabase.
8. IF existing Supabase data is imported later, THEN it SHALL be exported as CSV/SQL, cleaned if needed, and imported into matching InsForge tables.
9. THE migration SHALL be verified with InsForge SQL queries, not just by reading the file.

### Requirement 6B: Public Chrome Web Store product and rate limiting

**User Story:** As the product owner, I want normal users to install Slop Frog from the Chrome Web Store without letting them burn unlimited Modal inference, so that the product can be public without becoming financially unsafe.

#### Acceptance Criteria

1. THE end product SHALL support Chrome Web Store distribution.
2. THE public extension SHALL not require users to run a local model.
3. THE public extension SHALL not call Modal directly.
4. THE public extension SHALL call a Slop Frog controlled API through Runtype/InsForge.
5. THE controlled API SHALL check score cache before requesting live Modal inference.
6. IF a content item already has a fresh cached detector score, THEN the system SHALL reuse it without calling Modal.
7. Public anonymous users SHALL be severely rate-limited for live Modal inference.
8. The default public quota SHALL be 15 new uncached live inferences per rolling 24-hour window per install or account until a different business model exists.
9. After quota is exhausted, THE system SHALL still show cached scores, community scores, and gray states where appropriate.
10. Owner/admin users SHALL be able to bypass public rate limits.
11. Rate-limit bypass SHALL be enforced server-side, not only in the extension UI.
12. Rate-limit decisions SHALL be stored for observability and abuse debugging.

### Requirement 7: Slop Score and flag thresholds

**User Story:** As a user, I want one clear score behind the scenes and one simple flag in the feed, so that I am informed without being overwhelmed.

#### Acceptance Criteria

1. THE system SHALL compute a Slop_Score from detector score and community score when evidence is sufficient.
2. IF no community score exists, THEN the Slop_Score MAY equal the detector score.
3. IF community score exists, THEN the MVP weighting SHALL default to detector-heavy scoring, with community influence applied through a configured weight.
4. THE default labels SHALL be:
   - red: Slop_Score greater than or equal to 75;
   - yellow: Slop_Score from 40 through 74;
   - green: Slop_Score below 40;
   - gray: insufficient evidence or scoring failure.
5. THE LinkedIn MVP SHALL use platform-specific stricter labels:
   - red: LinkedIn Slop_Score greater than or equal to 40;
   - yellow/orange: LinkedIn Slop_Score from 21 through 39;
   - green: LinkedIn Slop_Score less than or equal to 20;
   - gray: insufficient evidence or scoring failure.
6. IF a user vote changes the Slop_Score across a threshold, THEN the visible flag color SHALL update immediately after the new score is returned.
7. THE UI SHALL hide raw numeric scores by default unless the user enables numeric scores or opens evidence.

### Requirement 8: Evidence coverage and gray state

**User Story:** As a user, I want Slop Frog to admit uncertainty, so that it does not call everything AI or human when it lacks signal.

#### Acceptance Criteria

1. THE system SHALL calculate evidence coverage before assigning red, yellow, or green.
2. THE system SHALL return gray when text is too short, extraction fails, detector is unavailable, detector times out, or the visible modality is unsupported.
3. THE evidence panel SHALL show the gray reason.
4. THE system SHALL NOT treat gray as human.
5. THE default MVP evidence coverage minimum SHALL be configurable.

### Requirement 9: In-feed UI

**User Story:** As a user, I want Slop Frog to feel native and compact inside my feed, so that it helps without ruining the social browsing experience.

#### Acceptance Criteria

1. THE extension SHALL render a compact action cluster per scored post.
2. THE action cluster SHALL include:
   - a colored flag button for evidence;
   - a white feedback/message icon button;
   - a white appeal/justice icon button.
3. THE flag icon SHALL reflect the current label color.
4. THE action cluster SHALL avoid colliding with native X or LinkedIn action buttons.
5. THE action cluster SHALL be placed near the lower-left/bottom action area when possible.
6. THE UI SHALL avoid unnecessary explanatory text.
7. THE evidence panel SHALL be closable.
8. THE evidence panel SHALL not block the user from opening feedback or appeal after it has been opened.
9. THE popup SHALL not show developer-only detector URL controls in the default polished view.
10. THE extension brand SHALL use green as the main brand color while preserving contrast and legibility.

### Requirement 10: Evidence panel

**User Story:** As a skeptical user, I want to inspect why a post was flagged, so that I can trust or challenge the result.

#### Acceptance Criteria

1. THE evidence panel SHALL show Slop Score.
2. THE evidence panel SHALL show detector score.
3. THE evidence panel SHALL show community score.
4. THE evidence panel SHALL show text, image, audio, and video rows.
5. THE evidence panel SHALL show unsupported modalities as unsupported or MVP text-first, not as scored.
6. THE evidence panel SHALL show gray reason when gray.
7. THE evidence panel SHALL show score-over-time graph.
8. THE evidence panel SHALL show volume-vs-score graph.
9. THE evidence panel SHALL use real verdict history data when available.
10. IF only one score event exists, THEN graph lines SHALL be flat or clearly single-point rather than fake movement.

### Requirement 11: Community feedback

**User Story:** As a user, I want to quickly correct or confirm a label, so that the community can improve the Slop Score.

#### Acceptance Criteria

1. THE feedback panel SHALL be opened from the feedback icon, not from inside the evidence panel.
2. THE allowed votes SHALL be `looks_ai`, `looks_human`, and `unsure`.
3. THE community score SHALL map `looks_human = 0`, `unsure = 50`, and `looks_ai = 100`.
4. THE community score SHALL use reviewer quality weights.
5. THE feedback submission SHALL update the relevant aggregate and visible flag when the new score crosses a threshold.
6. THE UI SHALL display community score without formatting bugs such as stray `.0` text.

### Requirement 12: Appeals

**User Story:** As a creator or viewer, I want to challenge a bad label, so that Slop Frog does not become an unchallengeable accusation machine.

#### Acceptance Criteria

1. THE appeal panel SHALL be opened from the appeal icon, not from inside the evidence panel.
2. THE appeal panel SHALL offer short choices such as human-written, AI-assisted, missing context, and other.
3. THE backend SHALL store appeal reason, status, content key, reviewer ID, and timestamps.
4. THE evidence panel SHALL show appeal status when available.
5. THE system SHALL preserve old verdicts when appeals change a label.

### Requirement 13: Auto-filtering

**User Story:** As a user, I want to optionally hide high-risk posts, so that I can reduce exposure to likely AI slop when I choose.

#### Acceptance Criteria

1. THE auto-filter setting SHALL be off by default.
2. THE extension SHALL collapse only red posts when auto-filter is enabled.
3. THE collapsed state SHALL include a reveal/show-post button.
4. IF the user disables auto-filter, THEN all auto-filter blockers SHALL be removed from currently visible posts.
5. THE collapsed post UI SHALL be compact, legible, and not a giant pale block.

### Requirement 14: Reviewer quality

**User Story:** As the product, I want trusted reviewers to count more than brand-new reviewers, so that community feedback is useful.

#### Acceptance Criteria

1. THE backend SHALL store reviewer quality/reputation.
2. New reviewers SHALL start with a low default quality weight.
3. Reviewer quality SHALL be used in community score aggregation.
4. The MVP MAY use simple deterministic weighting.
5. Future versions SHOULD update quality using agreement with later consensus, appeal outcomes, and eval-backed corrections.
6. The UI SHALL not shame low-quality reviewers.

### Requirement 15: Privacy and data minimization

**User Story:** As a user, I want Slop Frog to improve detection without grabbing my whole feed, so that the product stays trustworthy.

#### Acceptance Criteria

1. THE system SHALL not upload every visible post to storage as training data.
2. THE system MAY send visible post text to the scoring workflow because the detector needs text to score text.
3. THE system SHALL store explicit votes, appeals, post identifiers, scores, and limited metadata.
4. THE system SHALL avoid raw image, audio, and video storage in the MVP.
5. THE future training dataset SHALL remove PII before use.
6. THE future training dataset SHALL not include private profile data or unnecessary author identifiers.
7. THE backend SHALL track cleaning status before any labeled example is used for training.
8. THE public extension SHALL avoid sending every post for live inference once quota is exhausted.
9. THE system SHALL prefer cached post scores and community aggregates over repeated detector calls.

### Requirement 16: Learning loop and model improvement

**User Story:** As the product owner, I want community labels to improve the detector over time, so that Slop Frog gets better instead of staying static.

#### Acceptance Criteria

1. THE architecture SHALL include a future learning loop managed by Runtype.
2. THE loop SHALL collect explicit labeled examples from votes and appeals.
3. THE loop SHALL clean examples for privacy before dataset creation.
4. THE loop SHALL run evals before any model promotion.
5. THE loop SHALL support fine-tuning or adapter training when enough high-quality labeled data exists.
6. THE loop SHALL require human approval before replacing the production detector.
7. THE MVP SHALL set up architecture and metadata, but SHALL NOT blindly auto-train and deploy a model without eval gates.

### Requirement 17: Demo readiness

**User Story:** As a solo hackathon builder, I want one reliable demo path, so that I can present without depending on another teammate's machine.

#### Acceptance Criteria

1. THE demo SHALL run from the `modal-imbue-inference` branch unless a later branch explicitly replaces it.
2. THE demo SHALL load the unpacked Chrome extension.
3. THE demo SHALL show X flags.
4. THE demo SHOULD show LinkedIn flags if selectors are stable enough.
5. THE demo SHALL show Modal detector health.
6. THE demo SHALL show at least one evidence panel.
7. THE demo SHALL show one feedback submission path.
8. THE demo SHALL show one appeal submission path.
9. THE demo SHALL show auto-filter off by default and opt-in red-post hiding.
10. THE demo SHALL not depend on Cotal.
11. THE demo SHALL show that public users are rate-limited.
12. THE demo SHALL show that owner/admin mode is not rate-limited.
13. THE demo SHALL explain that Chrome Web Store users get safe limited inference, cached results, and community labels rather than unlimited Modal usage.

### Requirement 18: Chrome Web Store readiness

**User Story:** As a non-technical user, I want to install Slop Frog like any other Chrome extension, so that I can filter my feed without running developer tools.

#### Acceptance Criteria

1. THE production extension SHALL be packaged for Chrome Web Store submission.
2. THE production extension SHALL include a clear privacy disclosure.
3. THE production extension SHALL request only necessary host permissions.
4. THE production extension SHALL provide an onboarding state that explains the meaning of red, yellow, green, and gray in very few words.
5. THE production extension SHALL work without exposing developer URLs in the default popup.
6. THE production extension SHALL handle exhausted quota gracefully.
7. THE production extension SHALL explain that rate limits exist to keep the detector available and affordable.
8. THE owner/admin experience MAY expose diagnostic controls hidden from public users.

## Out of Scope for Current Hackathon Demo

1. Cotal integration.
2. Backend scraping of LinkedIn.
3. Raw image, audio, or video slop detection.
4. Full production anti-brigading.
5. Fully autonomous model promotion.
6. Chrome Web Store publication.
7. Facebook, Reddit, TikTok, Instagram, and YouTube support.
8. Production-scale privacy review.
9. Guaranteed detection of AI-edited images or videos.
10. Full paid subscription system.
11. Unlimited free hosted inference for public users.
12. Production Chrome Web Store approval itself, unless time allows submission packaging.

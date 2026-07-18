# Requirements Document

## Introduction

Slop Frog is a Chrome extension for X that flags likely AI-generated or AI-assisted feed content while the user scrolls. It is not a paste-in checker. The extension extracts visible X posts, sends them to a local detector running on the user's laptop, combines that detector signal with community labels stored in Supabase, and overlays a simple red, yellow, green, or gray flag on each post.

The MVP is built for a three-hour hackathon sprint by two people working in parallel after a shared-contract phase. The first target platform is X only. Local inference is mandatory for the MVP. Supabase is used only for shared community labeling, reviewer reputation, appeals, aggregate labels, and verdict history. The future training-data pipeline may be designed, but it must not scrape, rehydrate, or collect X posts automatically in the MVP.

Three rules are non-negotiable and shape every requirement below:

1. **No paste-in MVP.** Slop Frog must work automatically while the user scrolls on X.
2. **Local inference only.** The detector runs on the user's laptop through a localhost service. No hosted inference path is implemented for this MVP.
3. **Community data only in Supabase.** Supabase stores labels, reputation, appeals, hashes, verdict history, and optionally text for explicitly labeled posts. Raw image, audio, and video files are not stored in Supabase for the MVP.

## Glossary

- **Slop_Frog_System**: The full MVP, including the Chrome extension, local detector service, shared contracts, Supabase schema, and demo flow.
- **X_Post**: A visible post on X extracted by the extension from the feed DOM.
- **Post_Envelope**: The shared data object representing an extracted X_Post before scoring.
- **Content_Script**: The extension script injected into X pages to detect posts, extract data, and insert flag UI.
- **Background_Worker**: The Chrome extension service worker that coordinates scoring, caching, Supabase calls, and settings.
- **Local_Detector_Service**: The local HTTP service running on the user's laptop, exposed at `http://localhost:8765`.
- **Detector_Score**: A 0 to 100 AI evidence score returned by the Local_Detector_Service.
- **Evidence_Coverage**: A pre-score signal indicating whether there is enough usable evidence to responsibly produce a red, yellow, or green label.
- **Gray_Flag**: The no-signal state used when Evidence_Coverage is too low, extraction fails, or the local detector is unavailable.
- **Slop_Score**: The final 0 to 100 score computed from local detector output and community aggregate data.
- **Community_Label**: A user-submitted judgment that content looks AI-generated/AI-assisted, mostly human, or unsure.
- **Reviewer_Reputation**: A weight applied to a community reviewer based on prior review count, agreement with final labels, and appeal outcomes.
- **Content_Fingerprint**: A stable identifier for repost recognition, including normalized text hash and optional media hashes.
- **Evidence_Panel**: The expandable UI attached to a flag showing detector score, community score, modality score, provenance status, appeal status, and score history.
- **Compact_Action_Row**: The quiet icon-first control row beside an X post, containing separate evidence, feedback, and appeal buttons.
- **Feedback_Panel**: The focused panel opened from the feedback icon for community labeling.
- **Appeal_Panel**: The focused panel opened from the appeal icon for challenging a label.
- **Verdict_History**: A time-ordered record of how scores, labels, appeals, and community aggregates changed.
- **Training_Pipeline_Placeholder**: A future architecture section for periodic model improvement. It is inactive in the MVP and must not fetch X content.

## Requirements

### Requirement 1: X-only Chrome extension MVP

**User Story:** As a user scrolling X, I want Slop Frog to work inside my feed without copying and pasting content, so that I can evaluate posts in the moment.

#### Acceptance Criteria

1. THE Slop_Frog_System SHALL ship as a Chrome extension using Manifest V3.
2. THE Slop_Frog_System SHALL support X at `https://x.com/*` and `https://twitter.com/*` for the MVP.
3. THE Slop_Frog_System SHALL NOT require users to paste post content into a separate website or form for the core feed-labeling experience.
4. WHEN a supported X feed page loads, THE Content_Script SHALL detect visible X_Post elements without requiring a page refresh.
5. WHEN the user scrolls, THE Content_Script SHALL detect newly visible X_Post elements and queue them for scoring.
6. IF the user is not on X or Twitter, THEN THE extension SHALL not attempt feed extraction.

### Requirement 2: Shared contracts before parallel work

**User Story:** As a two-person hackathon team, we want shared contracts finished first, so that extension work and detector/backend work can proceed in parallel without breaking integration.

#### Acceptance Criteria

1. THE team SHALL define `Post_Envelope`, `Score_Request`, `Score_Response`, `Community_Aggregate`, `Slop_Score_Result`, `Flag_Label`, and `Extension_Settings` before Person A and Person B split implementation work.
2. THE shared contracts SHALL be stored in a shared package or copied contract file that both the extension and local detector can import or mirror exactly.
3. THE shared contracts SHALL define the allowed Flag_Label values as `red`, `yellow`, `green`, and `gray`.
4. THE shared contracts SHALL define the localhost detector endpoint as `POST /score`.
5. THE shared contracts SHALL define the Supabase tables and required columns before any UI depends on Supabase data.
6. THE shared contracts SHALL include at least three fixture posts used by both people for verification.
7. THE team SHALL NOT mark the shared-contract phase complete until both Person A and Person B can run the same fixture through their side of the contract without schema mismatch.

### Requirement 3: X post extraction

**User Story:** As the extension, I need to extract enough post data from X to score and label posts reliably.

#### Acceptance Criteria

1. THE Content_Script SHALL extract a stable post URL when available.
2. THE Content_Script SHALL extract a platform ID or tweet ID from the post URL when available.
3. THE Content_Script SHALL extract visible post text.
4. THE Content_Script SHALL extract visible author handle when available.
5. THE Content_Script SHALL extract visible timestamp or permalink timestamp when available.
6. THE Content_Script SHALL extract visible image URLs when available, but SHALL NOT upload raw images to Supabase.
7. THE Content_Script SHALL assign each extracted post a `contentKey` using `x:{tweetId}` when a tweet ID exists, otherwise a normalized text hash fallback.
8. IF extraction fails or the content is structurally ambiguous, THEN THE Content_Script SHALL produce a gray result with reason `extraction_failed`.

### Requirement 4: Local detector service

**User Story:** As a privacy-conscious user, I want the AI detector to run on my laptop, so that normal feed scoring does not require hosted inference.

#### Acceptance Criteria

1. THE Local_Detector_Service SHALL run on the user's laptop and listen on `http://localhost:8765`.
2. THE Local_Detector_Service SHALL expose `GET /health`.
3. THE Local_Detector_Service SHALL expose `POST /score`.
4. WHEN `POST /score` receives a valid Score_Request, THE service SHALL return a Score_Response within 10 seconds for the demo fixture posts.
5. THE Score_Response SHALL include `detectorScore`, `evidenceCoverage`, `labelRecommendation`, `reasons`, `modelName`, and `modelVersion`.
6. IF the post has too little usable signal, THEN THE Score_Response SHALL return `labelRecommendation = gray`.
7. IF the model is unavailable, THEN THE service SHALL return a typed error response rather than hanging.
8. THE MVP MAY use a deterministic heuristic or lightweight local model as a stand-in if the Bouncer-derived detector cannot be integrated in time.

### Requirement 5: Evidence coverage and gray flag

**User Story:** As a user, I want Slop Frog to admit when it does not have enough information, so that green does not falsely mean human.

#### Acceptance Criteria

1. THE Slop_Frog_System SHALL compute Evidence_Coverage before assigning red, yellow, or green.
2. THE Slop_Frog_System SHALL assign gray when Evidence_Coverage is below the configured minimum.
3. THE configured MVP minimum SHALL default to 50.
4. THE Evidence_Coverage calculation SHALL include text length and may include analyzable image presence, known fingerprint match, community review availability, and provenance availability.
5. THE Slop_Frog_System SHALL distinguish gray from yellow: gray means not enough signal; yellow means enough signal but mixed or medium AI evidence.
6. THE Evidence_Panel SHALL show the gray reason when the label is gray.

### Requirement 6: Slop Score and flags

**User Story:** As a user, I want one simple feed flag rather than many probabilities, so that I can understand the result while scrolling.

#### Acceptance Criteria

1. THE Slop_Frog_System SHALL compute a Slop_Score when Evidence_Coverage is sufficient.
2. THE Slop_Score SHALL combine local detector score and Supabase community aggregate when community aggregate exists.
3. IF no community aggregate exists, THEN THE Slop_Score SHALL be allowed to equal the local detector score for the MVP.
4. THE default flag thresholds SHALL be red above 75, yellow from 40 to 75 inclusive, and green below 40.
5. THE thresholds SHALL be stored in configuration, not hard-coded across unrelated modules.
6. THE extension SHALL display the flag on the corresponding X_Post.
7. THE default feed UI SHALL show the flag label without requiring the exact numeric score.
8. IF the user enables numeric scores, THEN THE extension SHALL show the Slop_Score in the Evidence_Panel or compact flag UI.

### Requirement 7: Auto-filtering

**User Story:** As a user, I want high-risk posts filtered while scrolling, so that I can reduce exposure to likely AI slop.

#### Acceptance Criteria

1. THE extension SHALL include a setting for auto-filtering red-flagged posts.
2. IF auto-filter is enabled and a post receives a red flag, THEN THE extension SHALL hide or collapse that post in the feed.
3. THE extension SHALL allow the user to reveal a filtered post.
4. THE extension SHALL NOT auto-filter yellow, green, or gray posts in the MVP.
5. THE default setting SHALL keep auto-filter disabled unless the user turns it on.

### Requirement 8: Evidence panel

**User Story:** As a user, I want to expand a flag and see why it appeared, so that I can trust or challenge the label.

#### Acceptance Criteria

1. THE extension SHALL provide an expandable Evidence_Panel for each labeled post.
2. THE Evidence_Panel SHALL show the Slop_Score when available.
3. THE Evidence_Panel SHALL show the Detector_Score when available.
4. THE Evidence_Panel SHALL show community aggregate when available.
5. THE Evidence_Panel SHALL show separate modality rows for text, image, audio, and video, with unsupported modalities marked unavailable.
6. THE Evidence_Panel SHALL explain gray labels in plain language.
7. THE Evidence_Panel SHALL NOT include community labeling controls or appeal submission controls.
8. THE extension SHALL render a separate Compact_Action_Row with an evidence button, feedback button, and appeal button.
9. THE feedback button SHALL open the Feedback_Panel.
10. THE appeal button SHALL open the Appeal_Panel.
11. THE Evidence_Panel and Compact_Action_Row SHALL not use color alone to communicate flag meaning.

### Requirement 9: Supabase community labeling

**User Story:** As a community member, I want to label content as AI-generated/assisted, mostly human, or unsure, so that the community signal improves the feed label.

#### Acceptance Criteria

1. THE Slop_Frog_System SHALL store community labels in Supabase.
2. A Community_Label SHALL include `contentKey`, `platform`, `vote`, `reviewerId`, `reviewerWeight`, and `createdAt`.
3. Allowed vote values SHALL be `looks_ai`, `looks_human`, and `unsure`.
4. THE MVP MAY store post text for explicitly labeled posts.
5. THE MVP SHALL NOT store raw image, audio, or video files in Supabase.
6. THE extension SHALL send a community label only when the user explicitly votes or appeals.
7. THE extension SHALL fetch aggregate community data for visible posts when a `contentKey` exists.

### Requirement 10: Reviewer reputation

**User Story:** As a product, we want experienced and accurate reviewers to count more than new or unreliable reviewers, so that community labels are harder to distort.

#### Acceptance Criteria

1. THE Supabase schema SHALL include reviewer records.
2. Each reviewer SHALL have a numeric reputation weight.
3. New reviewers SHALL start with a low default weight.
4. THE community aggregate SHALL use reviewer weights when computing community score.
5. THE MVP reputation calculation MAY be simple and deterministic.
6. THE UI SHALL not publicly shame low-reputation reviewers.

### Requirement 11: Content fingerprinting

**User Story:** As the system, I want reposted or lightly duplicated content to inherit prior labels, so that the community does not start from zero each time.

#### Acceptance Criteria

1. THE Slop_Frog_System SHALL compute a normalized text hash for each extracted post with text.
2. THE Slop_Frog_System SHALL store the normalized text hash in Supabase for explicitly labeled posts.
3. THE Slop_Frog_System SHALL use tweet ID as the strongest content identity when available.
4. THE Slop_Frog_System SHALL treat the fingerprint itself as immutable.
5. THE Slop_Frog_System SHALL allow verdicts attached to a fingerprint to change through appeals or new aggregate evidence.
6. THE MVP MAY defer perceptual image hashing if text and tweet ID fingerprinting are complete.

### Requirement 12: Appeals and verdict history

**User Story:** As a creator or viewer, I want a way to challenge a label, so that incorrect flags can be corrected.

#### Acceptance Criteria

1. THE Compact_Action_Row SHALL include a separate appeal action.
2. An appeal SHALL include `contentKey`, `reviewerId`, `reason`, `status`, and `createdAt`.
3. Allowed appeal statuses SHALL be `submitted`, `under_review`, `accepted`, and `rejected`.
4. THE Supabase schema SHALL preserve Verdict_History events.
5. Verdict_History events SHALL include initial score, community vote updates, appeal submitted, appeal resolved, and label changed.
6. THE MVP MAY allow an admin or demo reviewer to resolve appeals manually.
7. THE MVP SHALL preserve old labels when a verdict changes.

### Requirement 13: Versioned verdict graphs

**User Story:** As a reviewer or judge, I want to see how a label changed over time, so that Slop Frog is transparent and contestable.

#### Acceptance Criteria

1. THE Evidence_Panel or reviewer view SHALL include a longitudinal score graph.
2. The longitudinal graph SHALL use time on the x-axis and Slop_Score on the y-axis.
3. THE Evidence_Panel or reviewer view SHALL include a volume vs score graph.
4. The volume graph SHALL use review or repost volume on the x-axis and Slop_Score on the y-axis.
5. THE MVP MAY render simplified SVG or canvas graphs using local mock history if live history is unavailable.

### Requirement 14: Permissions and installation

**User Story:** As a user installing the extension, I want the extension to request only understandable permissions, so that I can trust it.

#### Acceptance Criteria

1. THE extension SHALL request host permissions only for X/Twitter, localhost detector, and the configured Supabase project.
2. THE extension SHALL NOT request access to all websites for the MVP.
3. THE extension SHALL request `storage` permission for settings and cache.
4. THE extension SHALL include a popup or options screen showing detector connection status.
5. IF the local detector is not running, THEN THE extension SHALL show a clear local-setup error rather than silently failing.
6. THE README SHALL explain that the MVP requires running a local detector service before using the extension.

### Requirement 15: Offline training data preparation

**User Story:** As the product team, we want community labels to become a privacy-safe future training dataset, so that the detector can improve without publishing PII or running hidden scraping jobs.

#### Acceptance Criteria

1. THE system SHALL store enough labeled metadata to make future dataset building possible, subject to platform terms and user consent.
2. THE system SHALL include an explicit offline workflow for authorized X post rehydration from labeled post IDs.
3. THE system SHALL NOT automatically scrape, rehydrate, or collect X posts from the backend.
4. THE system SHALL NOT run scheduled training jobs.
5. THE cleaned training dataset SHALL NOT include raw post URLs, raw tweet IDs, author handles, author IDs, profile fields, emails, phone numbers, addresses, payment numbers, or raw media files.
6. THE cleaner SHALL redact direct identifiers and block examples that still appear risky after redaction.
7. THE public dataset export SHALL include only cleaned rows with `pii_status = clean`.

### Requirement 16: Demo readiness

**User Story:** As a hackathon presenter, I want a reliable local demo path, so that the product can be shown within the remaining three-hour build window.

#### Acceptance Criteria

1. THE demo SHALL show the Chrome extension loaded in developer mode.
2. THE demo SHALL show the local detector health check passing.
3. THE demo SHALL show at least three visible X posts receiving flags.
4. THE demo SHALL show one evidence panel.
5. THE demo SHALL show one community vote being stored in Supabase or a verified local Supabase mock if credentials are unavailable.
6. THE demo SHALL show one red post being auto-filtered when auto-filter is enabled.
7. THE team SHALL NOT mark the demo complete until each demo step has been manually verified.

## Out of Scope for MVP

1. Platforms beyond X/Twitter and LinkedIn.
2. Hosted inference.
3. Automatic backend X scraping or rehydration.
4. Scheduled training jobs.
5. Raw image, audio, or video storage in Supabase.
6. Production anti-brigading.
7. Independent appeal review.
8. Full provenance verification.
9. Video and audio detection.
10. Chrome Web Store publication.

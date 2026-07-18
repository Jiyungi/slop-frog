# Slop Frog Feature Requirements

**Purpose:** Define the features Slop Frog must have for the first useful version.

Slop Frog is a Chrome extension that labels social feed content while the user scrolls. It helps users judge whether online content is likely AI-generated, AI-assisted, or low-risk. The product should stay simple: users see a clear flag first, and only open details when they want evidence.

The goal is not to perfectly prove whether something was made by AI. The goal is to combine model detection, community judgment, content provenance, fingerprinting, and appeals into a practical trust signal.

## Product Principles

1. **Simple by default:** Most users should only see a flag, not a wall of probabilities.
2. **Evidence when needed:** Users can expand a flag to see why the system made that call.
3. **Do not overclaim:** The system should say "strong AI evidence" rather than "definitely AI."
4. **Appeals must be possible:** A flagged creator or viewer must be able to challenge a label.
5. **Community input matters:** Human reviewers help correct model mistakes and improve future labels.
6. **Labels can change over time:** A post's score and label should update as new votes, appeals, or evidence arrive.
7. **No paste-in MVP:** The first version should work automatically on a supported platform feed, starting with X or LinkedIn.
8. **Local model first:** The MVP detector should run on the user's laptop and be called by the Chrome extension through a local service.

## Important Definitions

### AI score

The AI score is a 0 to 100 score estimating how much evidence suggests AI involvement.

For the MVP, do not call this a guaranteed probability unless the detector has been calibrated well enough to support that claim. In the UI, safer language is:

- "AI evidence score"
- "AI likelihood score"
- "Strong AI evidence"
- "Mixed or uncertain evidence"
- "Low AI evidence"

### Flags

Slop Frog should use simple flags:

- **Red flag:** composite score above 75. This means strong AI evidence.
- **Yellow flag:** composite score from 40 to 75. This means mixed or uncertain AI evidence.
- **Green flag:** composite score below 40. This means low AI evidence.

These thresholds should be adjustable later as the product collects more data.

### Does the green flag solve "insufficient evidence"?

No. A green flag and insufficient evidence are different.

A green flag means the system had enough signal and found low AI evidence. Insufficient evidence means the system does not have enough information to make a responsible judgment.

Example: a post with three words, a blurry image, or a short meme caption may not contain enough signal for the detector or community to judge. Calling that green would accidentally tell users "this seems human," when the more honest answer is "we do not know."

To keep the product simple, Slop Frog should support a fourth neutral state:

- **No flag / gray state:** not enough evidence yet.

This does not need to be visually complicated. It can simply appear as "Not enough signal" inside the evidence panel, or no feed flag at all until enough evidence exists.

### What triggers a gray flag?

A gray flag should not be triggered by a normal AI score. It should be triggered before scoring, when Slop Frog does not have enough usable signal to produce a responsible red, yellow, or green flag.

Use a simple evidence gate:

```text
if evidence_coverage < 50:
  label = "gray"
  reason = "not enough signal"
else:
  calculate composite score
```

Recommended MVP evidence coverage rules:

- add 40 points if the post has at least 20 analyzable words;
- add 20 points if the post has 8 to 19 analyzable words;
- add 30 points if the post has an accessible image that the MVP can analyze;
- add 30 points if the post matches an existing known fingerprint;
- add 20 points if the post has enough community reviews to produce a community score;
- add 10 points if provenance metadata is available.

Gray should appear when:

- the text is too short to judge;
- the media is inaccessible, too low-resolution, or unsupported;
- the post is mostly video/audio and the MVP does not support video/audio detection yet;
- the local model is unavailable or times out;
- there are not enough community reviews and no known fingerprint;
- the extension cannot reliably extract the post content from the page.

Yellow means "we have enough signal, but the evidence is mixed or medium-risk." Gray means "we do not have enough signal."

### AI-generated vs AI-edited

Do not force the MVP to classify content into hard categories like "AI-generated," "AI-edited," "human," and "uncertain."

Those categories are not always mutually exclusive. A human post can be lightly AI-edited. An AI-generated image can be posted with human-written commentary. A video can contain human footage with AI voiceover.

For the MVP, Slop Frog should use one simple composite score plus modality-level evidence. The product can say:

- "Text shows strong AI evidence."
- "Image shows low AI evidence."
- "Community review is split."
- "Final label: yellow flag."

This avoids overcomplicating the product while still handling mixed content honestly.

### Provenance

Provenance means the content's origin trail.

In plain English, provenance is the receipt attached to content. It can show where a piece of media came from, which device or software created it, whether it was edited, and sometimes whether AI tools were used.

Examples of provenance signals:

- A camera or editing app attached metadata to an image.
- A file includes C2PA Content Credentials.
- A creator or platform provides a verified creation history.
- A file says it was exported from an AI image tool or edited in a known editing app.

Provenance should be treated separately from AI detection. A detector guesses from the content itself. Provenance checks for attached receipts or creation history.

Missing provenance should not automatically make content suspicious. Most internet content has missing or stripped metadata.

## Must-Have Features

### 1. Chrome extension feed scanning

Slop Frog must be a Chrome extension for the MVP.

It should work while the user scrolls on a supported platform. The user should not need to paste content into a separate checker.

Start with one platform:

- X is the best first target if the team wants a Bouncer-like feed experience.
- LinkedIn is also acceptable if the team prefers professional posts and less chaotic media.

The extension should:

- detect visible posts in the feed;
- extract post text, author handle, post URL, timestamp if visible, and visible media URLs if available;
- send extracted content to the local detector;
- insert a red, yellow, green, or gray flag into the feed UI;
- cache scores so the same post is not rescored every time it appears;
- update flags when community or appeal data changes.

Each extracted item should store:

- platform;
- source URL if available;
- post text if available;
- media files or media URLs if available;
- author handle if available;
- extraction time;
- local score status.

### 2. Local laptop detector

Slop Frog must run the detector on the user's laptop for the MVP.

The Chrome extension should call a local service, such as:

- `http://localhost:PORT/score`;
- a small local Python or Node service;
- a local model runtime inspired by Bouncer's detector approach.

Important implementation note: do not assume the Chrome extension can directly run a large LLM inside the browser. The practical MVP is:

1. Chrome extension extracts posts from the feed.
2. Extension sends the post to a local server on the laptop.
3. Local server runs the detector.
4. Extension receives the score and displays the flag.

This still satisfies the product goal: detection runs on the user's laptop, not as a paste-in website.

### 3. Platform-aware model score

Slop Frog must run an AI detector or model-based judge on each visible feed item and return a score.

The detector should account for platform context when possible. A tweet, Facebook post, YouTube title, LinkedIn post, and image caption should not be judged exactly the same way.

Required output:

- model score from 0 to 100;
- model explanation in plain language;
- confidence level or "not enough signal" when the content is too short or weak to judge.

### 4. Separate modality scores

Slop Frog must analyze different content types separately before creating the final label.

Required modalities:

- text;
- image;
- video;
- audio.

For the MVP, text should be supported first. Image support is strongly preferred. Video and audio can exist in the data model as unsupported or gray until detectors are added.

Example:

| Modality | Score | Status |
| --- | ---: | --- |
| Text | 82 | Strong AI evidence |
| Image | 31 | Low AI evidence |
| Audio | N/A | Not available |
| Video | N/A | Not available |

### 5. Composite score

Slop Frog must combine model detection and community input into one composite score.

The composite score should be the main score used for red, yellow, and green flags.

Minimum MVP inputs:

- detector score;
- community score;
- reviewer reputation weight;
- provenance signal if available;
- appeal status if available.

Simple MVP formula:

```text
composite_score =
  detector_weight * detector_score
  + community_weight * weighted_community_score
  + provenance_adjustment
  + appeal_adjustment
```

The exact weights can be tuned later. For the first version, start simple and make the weights visible to the team in configuration.

Important rule: if there is not enough evidence, the system should return "not enough signal" instead of forcing a composite score.

### 6. Simple flag UI

Slop Frog must show a simple flag instead of overwhelming users with numbers.

Default feed view:

- red flag for strong AI evidence;
- yellow flag for mixed or uncertain AI evidence;
- green flag for low AI evidence;
- gray flag or no visible flag when there is not enough signal.

Optional expanded view:

- exact composite score;
- detector score;
- community score;
- modality scores;
- provenance status;
- appeal status;
- score history.

### 7. Option to show or hide the AI score

Users must be able to choose whether they see the numeric AI score.

Default:

- show only the flag.

Optional:

- show the composite score;
- show modality scores;
- show model and community contribution.

This keeps the product usable for normal users while still giving power users and reviewers more detail.

### 8. Auto-filter high-risk content

Users must be able to auto-filter content with a high composite score.

For the MVP, keep this simple:

- if red flag, allow automatic filtering while scrolling;
- yellow and green content should remain visible by default;
- users can turn auto-filtering on or off.

Advanced personal controls like choosing between hide, blur, deprioritize, or label-only are out of scope for now.

### 9. Community input

Slop Frog must let community members review content.

Simple MVP review options:

- "Looks AI-generated or AI-assisted";
- "Looks mostly human";
- "Unsure";
- optional short comment.

Do not require detailed evidence for every vote in the MVP. Required evidence is out of scope for now.

### 10. Community score on the feed

Users must be able to see community judgment on content.

Default view:

- simple community label such as "community leans AI," "community leans human," or "community unsure."

Expanded evidence panel:

- number of reviewers;
- weighted community score;
- percentage of votes in each direction;
- reviewer reputation contribution if available.

### 11. Community reviewer reputation

Slop Frog must weight community reviewers based on reputation.

New accounts should have lower influence at first. Reviewers gain influence when their past judgments align with later consensus, successful appeals, or verified evidence. Reviewers lose influence when their judgments are repeatedly overturned.

MVP reputation inputs:

- number of previous reviews;
- agreement with final labels;
- appeal outcomes;
- account age or trust level.

The reputation system should affect weighting, not public shaming.

### 12. Evidence panel

Slop Frog must let users expand a flag and see why the label exists.

The evidence panel should show:

- composite score;
- detector score;
- community score;
- separate modality scores;
- provenance status;
- appeal status;
- whether the item matched an existing fingerprint;
- score history graph;
- volume vs score graph.

The evidence panel should explain provenance in plain language, such as:

"Provenance is the content's origin receipt. It can show whether a file came from a camera, editing app, or AI tool when that information is available."

### 13. Content provenance checking

Slop Frog must check whether uploaded media includes provenance information.

For the MVP, provenance checking can be basic:

- detect whether metadata exists;
- detect whether C2PA Content Credentials exist;
- show whether provenance is present, missing, or unclear.

Provenance should influence the evidence panel and may influence the composite score, but it should not automatically decide the final label.

Important rules:

- valid provenance can support a label;
- missing provenance is common and should not be treated as proof of AI use;
- provenance can be forged, stripped, or incomplete, so it should be one evidence source, not the whole verdict.

### 14. Content fingerprinting

Slop Frog must create fingerprints for submitted content so reposts and lightly edited versions can inherit prior reviews.

Required fingerprint types:

- normalized text hash for text;
- perceptual image hash for images;
- video fingerprint based on sampled frames when video support exists;
- audio fingerprint when audio support exists.

Important correction: the hash itself should not be editable.

The hash is the content identity. If the hash is manually changed, Slop Frog can no longer recognize reposts or edited copies reliably.

What should be editable is the verdict attached to the hash.

Required behavior:

- if content matches a known fingerprint, inherit existing community reviews and score history;
- if an appeal succeeds, update the label attached to that fingerprint;
- preserve the old label in version history;
- allow different versions or clusters when content is materially changed.

### 15. Appeal system

Slop Frog must allow users to appeal a label.

MVP appeal flow:

1. User opens the evidence panel.
2. User clicks "Appeal label."
3. User selects why the label seems wrong.
4. Appeal status becomes visible.
5. Reviewers or admins can update the verdict.
6. The old and new verdicts are preserved in version history.

Appeal statuses:

- no appeal;
- appeal submitted;
- under review;
- appeal accepted;
- appeal rejected;
- label changed.

Appeal evidence uploads and independent appeal review are out of scope for now.

### 16. Versioned verdicts

Slop Frog must preserve how scores and labels changed over time.

Each content item or fingerprint should keep a timeline of verdict changes.

Events to store:

- initial detector score;
- new community votes;
- reputation-weighted community score changes;
- provenance detected or updated;
- appeal submitted;
- appeal decision;
- label changed.

Required charts:

- **Longitudinal score graph:** x-axis is time, y-axis is composite score.
- **Volume vs score graph:** x-axis is review or repost volume, y-axis is composite score.

This lets users and judges see whether a label became stronger, weaker, or more contested over time.

### 17. Threshold configuration

Slop Frog must allow thresholds to be changed later.

Default thresholds:

- red: above 75;
- yellow: 40 to 75;
- green: below 40.

The system should store thresholds in configuration, not hard-code them throughout the product.

### 18. Admin or reviewer dashboard

Slop Frog should include a simple dashboard for reviewing flagged content and appeals.

Minimum dashboard features:

- list flagged content;
- sort by highest composite score;
- sort by most appealed;
- sort by most reviewed;
- view evidence panel;
- update verdict after appeal.

This is important because the product depends on contestable labels, not one-shot model outputs.

## Out of Scope for Now

These features are useful, but they should not be part of the first build unless there is extra time.

1. **Anti-brigading controls:** Detecting coordinated voting, account farms, vote spikes, or conflicts of interest.
2. **Required evidence for votes:** Forcing reviewers to provide detailed reasons before voting.
3. **Consensus quality indicator:** Showing whether the community broadly agrees, is divided, or lacks enough reviewers.
4. **Creator disclosure:** Letting creators voluntarily mark content as AI-generated or AI-assisted.
5. **Appeal evidence uploads:** Uploading original files, edit histories, project files, source footage, or Content Credentials during appeals.
6. **Independent appeal review:** Ensuring appeals are reviewed only by people who did not participate in the original decision.
7. **Detector diversity:** Combining many independent detectors into one verdict.
8. **Full model and dataset versioning:** Maintaining a robust audit log of detector model versions and training datasets.
9. **Advanced personal controls:** Choosing between hidden, blurred, deprioritized, or label-only modes.
10. **False-positive feedback shortcut:** One-tap "this label seems wrong" outside the appeal flow.
11. **Full language and accessibility evaluation:** Measuring detector accuracy separately across languages and accessibility contexts.
12. **Full privacy controls:** Advanced privacy dashboards, sync controls, and policy settings. Local detector execution is in scope for the MVP, but a complete privacy settings system is not.

## MVP Build Order

1. Build Chrome extension scaffolding.
2. Choose first supported platform: X or LinkedIn.
3. Extract visible feed posts while the user scrolls.
4. Build a local laptop detector service.
5. Connect the extension to the local detector.
6. Add red, yellow, green, and gray/no-signal states.
7. Add automatic filtering for red-flagged content.
8. Add community voting.
9. Add reputation-weighted community scoring.
10. Add composite score calculation.
11. Add evidence panel.
12. Add simple provenance detection for visible or fetched media when available.
13. Add content fingerprinting and verdict inheritance.
14. Add appeal flow.
15. Add versioned verdict timeline.
16. Add longitudinal score graph and volume vs score graph.
17. Add simple reviewer/admin dashboard.

## Short Pitch Version

Slop Frog is a Chrome extension that works while users scroll on X or LinkedIn. It runs an AI detector locally on the user's laptop, then adds a simple red, yellow, green, or gray flag to each post. If users want more detail, they can open an evidence panel showing detector scores, community judgment, provenance, appeal status, and how the label changed over time.

The product stays simple by avoiding hard categories like "AI-edited" or "fully AI-generated" in the MVP. Instead, it shows a practical AI evidence score and lets the label improve through community review and appeals.

# Slop Frog Extension UI

## What the user sees

Slop Frog should feel like a small trust layer added to X and LinkedIn, not a separate app. The user scrolls normally. Each supported post gets a compact Slop Frog control group near the lower-left/bottom action area of the post.

The UI must avoid generic AI-looking product patterns: too much text, big explanatory boxes, awkward badges, random icon choices, and panels that collide with the platform's native controls.

The most important UI rule is: **less text unless the user is answering a question.** Social apps do not explain obvious controls with paragraphs. Slop Frog should use recognizable icons, clear color, short tooltips, and tight spacing.

Default control group:

```text
[colored flag] [feedback icon] [appeal icon]
```

The three controls are separate:

- flag opens evidence only;
- feedback opens community feedback only;
- appeal opens appeal only.

## Icon direction

The icons should look like real app icons, not markdown-drawn placeholders.

### Flag / evidence

- Use a real flag silhouette.
- The icon/fill follows the current label color:
  - red for red;
  - yellow for yellow;
  - green for green;
  - neutral gray for gray.
- Tooltip: `View evidence`.

### Feedback

- Use a clean message or chat-bubble icon.
- Icon should be white for contrast on dark or dark-green backgrounds.
- Green can be used for the button border or hover state.
- Tooltip: `Add feedback`.

### Appeal

- Use a justice scale or shield/appeal icon.
- Icon should be white for contrast on dark or dark-green backgrounds.
- Green can be used for the button border or hover state.
- Tooltip: `Appeal label`.

## Flag states

### Red

Meaning: high Slop Score.

Behavior:

- post remains visible unless auto-filter is enabled;
- if auto-filter is enabled, the post collapses;
- user can always reveal the post;
- clicking the flag opens evidence.

### Yellow

Meaning: medium or mixed Slop Score.

Behavior:

- post remains visible;
- clicking the flag opens evidence.

### Green

Meaning: low Slop Score.

Behavior:

- post remains visible;
- raw number stays hidden unless the user opens evidence or enables score display.

### Gray

Meaning: not enough signal or scoring unavailable.

Behavior:

- post remains visible;
- evidence explains the gray reason;
- gray must never be treated as human.

Common gray reasons:

- post text is too short;
- detector workflow unavailable;
- Modal cold start or timeout;
- extraction failed;
- media-only post unsupported;
- unsupported modality.

## Placement rules

The controls should be placed near the post's lower-left/bottom action area without pushing native buttons sideways.

Rules:

- do not insert controls in the middle of the post body;
- do not cover media;
- do not squeeze reply/repost/like/share controls;
- do not float a giant panel over unrelated posts;
- prefer an absolutely positioned or visually independent cluster when native action-row insertion causes collisions;
- test text-only posts, quote posts, image posts, video posts, replies, and reposts.

## Evidence panel

Clicking the flag opens evidence. The evidence panel is for explanation only; it must not include voting or appeal actions.

The panel shows:

- Slop Score;
- detector score;
- community score;
- text/image/audio/video rows;
- gray reason when gray;
- model name/version when available;
- score-over-time graph;
- volume-vs-score graph.

Graph honesty rules:

- if verdict history exists, use real history;
- if only one event exists, show a single point or flat line;
- if no real history exists, show unavailable;
- never render fake upward movement just to make the UI feel alive.

The evidence panel must:

- be closable;
- not trap clicks;
- not permanently block feedback or appeal;
- stay compact enough for feed browsing.

## Feedback panel

Clicking feedback opens a focused panel with one question.

```text
Community feedback
What do you think?

[Looks AI] [Looks human] [Unsure]
```

Rules:

- this is the one place where a short question is okay;
- do not show detector details here;
- keep the choices large enough to click;
- after submission, update the Slop Score and visible flag if the threshold changes.

## Appeal panel

Clicking appeal opens a focused panel with one question.

```text
Appeal label
Why is this wrong?

[Human-written]
[AI-assisted]
[Missing context]
[Other]
```

Rules:

- keep appeal separate from feedback;
- use short choices;
- do not bury appeal inside evidence;
- after submission, show submitted/under-review status when available.

## Red auto-filter state

Auto-filter must be off by default. If enabled, only red posts collapse.

Collapsed state should be compact:

```text
Slop Frog hid this post
Red flag - 93
[Show post] [Evidence]
```

Rules:

- no huge pale block;
- no awkward multi-line warning wall;
- user can reveal the original post;
- disabling auto-filter removes current blockers;
- yellow, green, and gray never collapse in the MVP.

## Extension popup

The popup is a simple control center, not a developer settings page.

It should show:

- Slop Frog branding with green identity;
- detector/workflow status;
- community/backend status;
- quota status for public users;
- show numeric Slop Score toggle;
- auto-filter red posts toggle.

It should not show by default:

- raw localhost URLs;
- long setup text;
- noisy developer diagnostics;
- unnecessary explanatory copy.

Advanced/debug information can be hidden behind a small secondary action later.

## Public quota states

Public Chrome Web Store users are rate-limited. The UI should make this understandable without making the product feel broken.

Use short language:

```text
Live checks left: 1
```

or:

```text
Live checks used
Cached flags still work
```

Rules:

- do not mention Modal cost in the main UI;
- do not make quota warnings huge;
- if quota is exhausted, uncached posts can show gray with reason `rate_limited`;
- cached and community-backed posts should still render normal flags;
- owner/admin mode may show a small `Admin` or `Demo` indicator in debug builds only.

## Visual direction

Slop Frog should feel compact, green, slightly playful, and trustworthy.

Use:

- rounded cards;
- soft shadows;
- high contrast text;
- green brand accents;
- white icons on dark/green controls;
- small pill buttons;
- consistent spacing.

Avoid:

- sharp clutter;
- huge overlays;
- pale blocks on dark feeds;
- text walls;
- fake charts;
- placeholder-looking icons;
- controls that collide with native platform UI.

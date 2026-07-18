# Slop Frog Extension UI

## What the user sees

Slop Frog should feel like a small trust layer added to X, not a separate app. The user scrolls normally. Each scored post gets a compact Slop Frog flag near the post actions or upper-right area of the post container.

UI work must use the Impeccable design skill guidance. The extension should avoid generic AI-looking UI patterns, unnecessary explanatory copy, oversized cards, and text-heavy panels.

The most important UI rule is: **less text unless the user is answering a question.** A good product does not explain every obvious surface. Social apps do not label the home button with "Here is the homepage where posts from other users appear." Slop Frog should use clear compact buttons, familiar icons, short labels, and tooltips. Too much explanatory text makes the product feel AI-generated.

The default UI is intentionally small:

```text
+----------------------------------------------+
| @author                                      |
| This is the X post text...                   |
|                                              |
| [reply] [repost] [like]   [Yellow] [F] [A]   |
+----------------------------------------------+
```

The compact controls are:

- flag button: opens evidence only;
- feedback button: opens community feedback only;
- appeal button: opens appeal flow only.

The buttons should be simple, quiet, and non-distracting. Use icons with short accessible labels and hover/tooltips. Do not put long explanatory text beside every icon.

Recommended lucide icons:

- flag/evidence: `Flag`;
- feedback: `MessageSquareCheck`;
- appeal: `ShieldAlert`.

Fallback labels if icons are unavailable:

- `Flag`;
- `Feedback`;
- `Appeal`.

## Compact flag states

### Red

Text:

```text
Slop Frog: Red
```

Meaning:

```text
Strong AI evidence
```

Behavior:

- if auto-filter is off, the post remains visible;
- if auto-filter is on, the post collapses;
- user can always reveal the post;
- clicking the flag opens the evidence panel.

### Yellow

Text:

```text
Slop Frog: Yellow
```

Meaning:

```text
Mixed or medium AI evidence
```

Behavior:

- post remains visible;
- clicking opens the evidence panel.

### Green

Text:

```text
Slop Frog: Green
```

Meaning:

```text
Low AI evidence
```

Behavior:

- post remains visible;
- numeric Slop Score stays hidden unless the user enables scores.

### Gray

Text:

```text
Slop Frog: Gray
```

Meaning:

```text
Not enough signal
```

Behavior:

- post remains visible;
- evidence panel explains why no score was produced;
- gray must never be treated as green.

Common gray reasons:

- post text is too short;
- local detector is not running;
- post extraction failed;
- media type is unsupported;
- detector timed out.

## Compact action buttons

The three controls should sit together and stay visually lighter than X's native action row.

```text
[Yellow] [MessageSquareCheck] [ShieldAlert]
```

The user should be able to figure out the basic interaction from the icons, placement, and tooltip. The UI should not say things like "Click here to provide community feedback on whether this post is AI-generated" unless the user has opened the feedback form.

### Flag button

Purpose:

```text
Open evidence
```

Icon:

```text
Flag
```

Visible text:

```text
Red
Yellow
Green
Gray
```

Tooltip:

```text
View Slop Score evidence
```

### Feedback button

Purpose:

```text
Submit community label
```

Icon:

```text
MessageSquareCheck
```

Visible text:

```text
None by default, icon only
```

Tooltip:

```text
Add feedback
```

### Appeal button

Purpose:

```text
Challenge the label
```

Icon:

```text
ShieldAlert
```

Visible text:

```text
None by default, icon only
```

Tooltip:

```text
Appeal label
```

## Expanded evidence panel

When the user clicks the compact flag, the post expands a small inline panel below the flag.

```text
+----------------------------------------------+
| Slop Frog Evidence                           |
|                                              |
| Slop Score: 82                               |
| Flag: Red                                    |
|                                              |
| Local detector: 88                           |
| Community: 64 from 12 reviews                |
| Text: Strong AI evidence                     |
| Image: Not available                         |
| Audio: Unsupported                           |
| Video: Unsupported                           |
|                                              |
| Why: polished generic phrasing, low entropy  |
|                                              |
| Score over time:     _/--                    |
| Volume vs score:    . . * *                  |
+----------------------------------------------+
```

The panel should show:

- Slop Score;
- flag state;
- local detector score;
- community score and vote count;
- modality rows for text, image, audio, and video;
- gray reason when gray;
- simple score-over-time graph;
- simple volume-vs-score graph.

The evidence panel must not include feedback voting controls or appeal controls. Those are separate actions beside the flag.

## Feedback panel

When the user clicks the feedback icon, open a small focused panel. This is the place where a question is appropriate, so a little text is allowed.

```text
+----------------------------------------------+
| Community feedback                           |
| What do you think?                           |
|                                              |
| [Looks AI] [Looks human] [Unsure]            |
|                                              |
| [Submit]                                     |
+----------------------------------------------+
```

Rules:

- keep the first version to one question;
- make the three choices large enough to tap/click;
- do not show detector details here;
- optional notes can be added later, but should not be visible by default.

## Appeal panel

When the user clicks the appeal icon, open a separate focused panel.

```text
+----------------------------------------------+
| Appeal label                                 |
| Why is this wrong?                           |
|                                              |
| [Human-written]                              |
| [AI-assisted, not fully AI]                  |
| [Missing context]                            |
| [Other]                                      |
|                                              |
| [Submit appeal]                              |
+----------------------------------------------+
```

Rules:

- keep appeal separate from community feedback;
- ask one clear question;
- use short answer choices;
- do not bury the appeal action inside the evidence panel.

## Red auto-filter state

If auto-filter is enabled and a post is red, the post becomes a collapsed warning row:

```text
+----------------------------------------------+
| Slop Frog hid this post                      |
| Reason: Red flag, strong AI evidence         |
| Slop Score: 82                               |
| [Show post] [Open evidence]                  |
+----------------------------------------------+
```

Rules:

- only red posts collapse;
- yellow, green, and gray stay visible;
- the user can reveal the original post;
- the collapsed state must not remove the ability to vote or appeal.

## Extension popup

The popup is the control center. It appears when the user clicks the Chrome extension icon.

```text
+------------------------------+
| Slop Frog                    |
|                              |
| Local detector: Connected    |
| Supabase: Connected          |
|                              |
| Show numeric Slop Score  [ ] |
| Auto-filter red posts    [ ] |
|                              |
| Detector URL                 |
| http://localhost:8765        |
+------------------------------+
```

Minimum popup controls:

- local detector health status;
- Supabase connection status;
- show numeric Slop Score toggle;
- auto-filter red posts toggle;
- local detector URL.

## Local detector offline state

If the local detector is not running, the extension should not fail silently.

The popup should show:

```text
Local detector: Not connected
Start the local detector at http://localhost:8765
```

The feed should show gray flags or a small status message:

```text
Slop Frog: Gray
Local detector unavailable
```

## Visual direction

Slop Frog should look restrained and trustworthy. It should not look like a giant warning system pasted over X.

Recommended UI style:

- compact pill flags;
- simple borders;
- readable text;
- no giant modals;
- no full-page overlays;
- no color-only meaning;
- no clutter around every post.

The extension should feel like a careful annotation layer: visible enough to help, quiet enough that scrolling still feels normal.

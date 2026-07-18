# Slop Frog Extension UI

## What the user sees

Slop Frog should feel like a small trust layer added to X, not a separate app. The user scrolls normally. Each scored post gets a compact Slop Frog flag near the post actions or upper-right area of the post container.

The default UI is intentionally small:

```text
+----------------------------------------------+
| @author                                      |
| This is the X post text...                   |
|                                              |
| [reply] [repost] [like]   Slop Frog: Yellow  |
+----------------------------------------------+
```

The exact icon can change, but the label must not rely on color alone. Each state needs text, color, and a small symbol.

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
- user can always reveal the post.

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
| [Looks AI] [Looks human] [Unsure] [Appeal]   |
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
- vote buttons;
- appeal button;
- simple score-over-time graph;
- simple volume-vs-score graph.

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

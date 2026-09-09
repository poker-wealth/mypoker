# Placeholder art and footage — REPLACE BEFORE LAUNCH

Stand-ins for [`/home`](../../../src/pages/Home.tsx), taken from the HHPoker
reference site so the page has real footage and real proportions to lay out
against. **None of this is ours.** The clips carry HH Poker's branding and
Chinese titles; the banners have their marketing copy baked in.

| File | Stands in for | Source |
|---|---|---|
| `video/welcome-1..4.mp4` | The four gameplay clips (~29 MB total) | `hhpoker/video/videoN.mp4` |
| `video-cover-1..4.png` | The clip thumbnails | `video-entryN-zh.png` |

## Swapping in the real thing

`REEL` at the top of [`Home.tsx`](../../../src/pages/Home.tsx) is the only place
these paths appear. Point it at the new files; nothing else changes. (The three
feature banners have already been replaced and live in `public/home/`.)

The tile labels are **not** in this folder — they come from the `gameNames.*`
locale keys the app already ships in all eight languages, and they name games
this platform actually runs. The borrowed footage does not match those labels
and will not until it is replaced.

## Sizes worth matching

- **Clips** — 16:9. `welcome-2.mp4` is 14 MB on its own; the four together are
  about 29 MB, all served as plain static files with no streaming in front of
  them. Worth re-encoding when the real ones land.
- **Covers** — square-ish; the tile is `29 × 29` units and crops with `cover`.

Then delete this folder.

## Why the words are not in the pictures

Same rule as the download page: the reference bakes its copy into the artwork,
Chinese only. Ours keeps every sentence as a translated string — the tile
labels, and the `alt` on each banner — so `check:locales` can see them and all
eight languages get real text. Replacement art should keep that property:
**no words in the picture**.

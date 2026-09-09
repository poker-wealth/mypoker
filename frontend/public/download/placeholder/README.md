# Placeholder art — REPLACE BEFORE LAUNCH

Stand-in images for [`/download`](../../../src/pages/Download.tsx), on loan from the
HHPoker reference site so the page has real pixels to lay out against. **None of
this is ours.**

Every file below is a screenshot or banner from a competitor's site. They carry
HHPoker's logo and Chinese-only baked-in text. They exist so the layout can be
reviewed at the right proportions — nothing more.

| File | Stands in for | Source |
|---|---|---|
| `hero-1.png`, `hero-2.png` | The two hero carousel slides — **Olivia's replacements go here** | `banner1-zh.png`, `banner2-zh.png` |
| `shot-android-1..8.png` | Install-guide frames, Android tab | `android-tutorials-stepN-zh.png` |
| `shot-ios-1..3.png` | Install-guide frames, iPhone and Telegram tabs | `ios-tutorials-stepN-zh.png` |
| `domain-bg-top.png`, `domain-bg-bottom.png` | The textured strips behind the domain bar | `domain-bg1.png`, `domain-bg2.png` |

The domain bar is off by default (`SITE_DOMAIN` / `MIRROR_DOMAINS` are unset), so
those last two only appear once it is configured.

## Swapping in the real art

The page reads one constant. Point it at the new files and nothing else changes:

```ts
// src/pages/Download.tsx
const PLACEHOLDER = {
  hero: ['/download/hero-1.png', '/download/hero-2.png'],
  ...
};
```

Keep the aspect ratios — `2048 / 820` for the hero, `241 / 516` for an Android
frame, `240 / 487` for an iPhone one. The frames are sized by ratio, not by the
file, so art that matches drops in without touching the layout.

Then delete this folder.

## Why the words are not in the pictures

The reference bakes its captions into the PNGs — eleven images, Chinese only.
Ours are separate translated strings under each frame, so `check:locales` can
see them and all eight languages get a real caption. That is also why every
image here renders with `alt=""`: it is decoration beside the text, never the
text itself. Replacement art should keep that property — **no words in the
picture**.

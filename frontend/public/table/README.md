# Table designs

The felts a player can choose between, from the button in the top-right of the table screen.

Files here are the artwork; the numbers that make seats land on each one live in
[`src/lib/tableDesigns.ts`](../../src/lib/tableDesigns.ts).

| File | Design | Size |
|---|---|---|
| `image copy.png` | **Midnight Blue** — black leather rail, gold trim, blue LED glow | 512 × 768 |
| `table.png` | **Emerald Classic** — casino green felt on a tournament rail | 941 × 1672 |
| *(none)* | **Neon Violet** — drawn in CSS from the brand palette, so there's always a table even with no images | — |

## Adding a design

1. Drop the image in this folder.
2. Add an entry to `TABLE_DESIGNS` in `src/lib/tableDesigns.ts`:

```ts
{
  id: 'ruby',
  name: 'Ruby',
  blurb: 'What a player reads under the name',
  artUrl: '/table/ruby.png',      // URL-encode spaces as %20
  aspect: '512 / 768',            // the image's real width / height
  boardTop: '50%',                // where the board sits on the felt
  accent: '#f43f5e',              // seat rings, open chairs, the clock
  rings: stadiumRings({ x: 17, yTop: 12, yBottom: 92, yMid: 52 }),
}
```

It appears in the picker immediately — nothing else in the app needs touching.

## Getting the seats right

`rings` positions each chair as a percentage of the image, so it only holds if the table fills the
canvas the same way. For a portrait stadium table, `stadiumRings` takes four measurements:

- `x` — how far in from the left edge the rail sits (the right side mirrors it)
- `yTop` / `yBottom` — the rail at the top and bottom ends
- `yMid` — the vertical middle of the table; the side seats sit ±12% from it

Measure them off the image in any editor, as percentages. If a design isn't a stadium shape, write
the six positions out by hand instead — `stadiumRings` is just a shortcut, not a requirement.

## Notes

- **Portrait only.** All the designs are taller than they are wide; the seat rings and the board
  placement assume it.
- **Seat numbers are fixed.** Seat 3 is the same chair on every screen and in every design — the
  view doesn't rotate to put you at the bottom, so the chair you pick is the chair you keep.
- **A missing image is survivable.** If a file is renamed or fails to load, that design falls back
  to the CSS table rather than leaving a blank screen mid-hand.

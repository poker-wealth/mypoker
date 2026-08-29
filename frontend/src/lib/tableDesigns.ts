/**
 * Table designs — the surfaces a player can choose between.
 *
 * A design is the artwork plus the numbers that make seats land on ITS rail: how tall the table is,
 * where the six chairs sit, and where the board falls on the felt. Keeping those together is the
 * point — swapping the picture without moving the seats would leave players floating off the edge.
 *
 * ► Adding one: drop the image in `public/table/`, add an entry below with its aspect and a seat
 *   ring measured off the art (percentages of the image, left/top of each seat's centre). Nothing
 *   else in the app needs to change — the picker lists whatever is in here.
 */

export type SeatAlign = 'bottom' | 'top' | 'left' | 'right';

export interface SeatPos {
  left: string;
  top: string;
  /** Which way the seat's chips and bubbles lean — outward from the middle of the table. */
  align: SeatAlign;
}

export interface TableDesign {
  id: string;
  name: string;
  /** Short note shown under the name in the picker. */
  blurb: string;
  /** The artwork, or null to draw the table in CSS from the brand tokens. */
  artUrl: string | null;
  /** CSS aspect-ratio of the table area, matching the artwork's proportions. */
  aspect: string;
  /** Vertical centre of the board/pot, as a % of the table height. */
  boardTop: string;
  /** Seat rings by table size. 6 is the house size; others are derived from it. */
  rings: Record<number, SeatPos[]>;
  /** Accent used for the seat rings and open-chair outlines on this felt. */
  accent: string;
}

/**
 * Six seats on a portrait stadium table: bottom-centre, then clockwise. The left/right pairs sit at
 * the straight sections of the rail, the other two at the rounded ends.
 */
function stadiumRings(edge: { x: number; yTop: number; yBottom: number; yMid: number }): Record<number, SeatPos[]> {
  const { x, yTop, yBottom, yMid } = edge;
  const right = 100 - x;
  const six: SeatPos[] = [
    { left: '50%', top: `${yBottom}%`, align: 'bottom' },
    { left: `${x}%`, top: `${yMid + 12}%`, align: 'left' },
    { left: `${x}%`, top: `${yMid - 12}%`, align: 'left' },
    { left: '50%', top: `${yTop}%`, align: 'top' },
    { left: `${right}%`, top: `${yMid - 12}%`, align: 'right' },
    { left: `${right}%`, top: `${yMid + 12}%`, align: 'right' },
  ];
  return {
    2: [six[0]!, six[3]!],
    3: [six[0]!, six[2]!, six[4]!],
    4: [six[0]!, six[1]!, six[3]!, six[5]!],
    5: [six[0]!, six[1]!, six[2]!, six[4]!, six[5]!],
    6: six,
  };
}

/**
 * Six seats on a LANDSCAPE stadium table: three along the bottom rail, three
 * along the top, mirroring the three cushion segments the artwork actually has.
 *
 * Not a rotation of `stadiumRings`. That one puts its side pairs on the long
 * straight edges, which on a wide table are the top and bottom — so reusing it
 * here would drop four players into the middle of the felt. The rounded ends of
 * a landscape table are short enough that seating anyone there crowds the
 * neighbours, so the ends stay empty and the seats spread along the straights.
 *
 * Hero is always index 0, bottom-centre.
 */
function wideRings(edge: {
  /** Horizontal inset of the outer seats, as a % of width. */
  x: number;
  yTop: number;
  yBottom: number;
}): Record<number, SeatPos[]> {
  const { x, yTop, yBottom } = edge;
  const right = 100 - x;
  // Outer seats sit slightly further in from the rail than the centre ones,
  // following the curve of the oval rather than a straight line.
  const yTopOuter = yTop + 6;
  const yBottomOuter = yBottom - 6;
  const six: SeatPos[] = [
    { left: '50%', top: `${yBottom}%`, align: 'bottom' },
    { left: `${x}%`, top: `${yBottomOuter}%`, align: 'bottom' },
    { left: `${x}%`, top: `${yTopOuter}%`, align: 'top' },
    { left: '50%', top: `${yTop}%`, align: 'top' },
    { left: `${right}%`, top: `${yTopOuter}%`, align: 'top' },
    { left: `${right}%`, top: `${yBottomOuter}%`, align: 'bottom' },
  ];
  return {
    // Heads-up faces you across the table, which on a wide felt is top-centre.
    2: [six[0]!, six[3]!],
    3: [six[0]!, six[2]!, six[4]!],
    4: [six[0]!, six[1]!, six[3]!, six[5]!],
    5: [six[0]!, six[1]!, six[2]!, six[4]!, six[5]!],
    6: six,
  };
}

export const TABLE_DESIGNS: TableDesign[] = [
  {
    id: 'midnight',
    name: 'Midnight Blue',
    blurb: 'Black leather rail, gold trim, blue LED glow',
    artUrl: '/table/image%20copy.png',
    aspect: '512 / 768',
    boardTop: '50%',
    accent: '#3b82f6',
    rings: stadiumRings({ x: 17, yTop: 12, yBottom: 92, yMid: 52 }),
  },
  {
    id: 'emerald',
    name: 'Emerald Classic',
    blurb: 'Casino green felt on a tournament rail',
    artUrl: '/table/table.png',
    aspect: '941 / 1672',
    boardTop: '50%',
    accent: '#34d399',
    rings: stadiumRings({ x: 14, yTop: 9, yBottom: 91, yMid: 50 }),
  },
  /**
   * The two Short Deck felts. Landscape, unlike everything above — the art is
   * `table.png` turned on its side (1672×941 against its 941×1672), so the seat
   * ring comes from `wideRings` rather than `stadiumRings`.
   *
   * They are ordinary entries in this list, so the picker offers them on any
   * table. Binding them to the short-deck variant is a separate decision about
   * whether the game or the player chooses the felt.
   */
  {
    id: 'shortdeck-green',
    name: 'Short Deck Green',
    blurb: 'Wide six-max felt, classic casino green',
    artUrl: '/table/shortdeck.png',
    aspect: '1672 / 941',
    boardTop: '50%',
    accent: '#34d399',
    rings: wideRings({ x: 22, yTop: 13, yBottom: 87 }),
  },
  {
    id: 'shortdeck-blue',
    name: 'Short Deck Blue',
    blurb: 'The same wide felt in tournament blue',
    artUrl: '/table/shortdec.png',
    aspect: '1672 / 941',
    boardTop: '50%',
    accent: '#3b82f6',
    rings: wideRings({ x: 22, yTop: 13, yBottom: 87 }),
  },
  {
    id: 'neon',
    name: 'Neon Violet',
    blurb: 'Drawn in CSS from the brand palette — always available',
    artUrl: null,
    aspect: '3 / 4',
    boardTop: '50%',
    accent: 'var(--accent)',
    rings: {
      2: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '50%', top: '10%', align: 'top' },
      ],
      3: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '13%', top: '30%', align: 'left' },
        { left: '87%', top: '30%', align: 'right' },
      ],
      4: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '11%', top: '50%', align: 'left' },
        { left: '50%', top: '10%', align: 'top' },
        { left: '89%', top: '50%', align: 'right' },
      ],
      5: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '12%', top: '64%', align: 'left' },
        { left: '15%', top: '20%', align: 'left' },
        { left: '85%', top: '20%', align: 'right' },
        { left: '88%', top: '64%', align: 'right' },
      ],
      6: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '13%', top: '71%', align: 'left' },
        { left: '13%', top: '28%', align: 'left' },
        { left: '50%', top: '10%', align: 'top' },
        { left: '87%', top: '28%', align: 'right' },
        { left: '87%', top: '71%', align: 'right' },
      ],
    },
  },
];

export const DEFAULT_DESIGN_ID = 'midnight';

export function designById(id: string | null | undefined): TableDesign {
  return TABLE_DESIGNS.find((d) => d.id === id) ?? TABLE_DESIGNS[0]!;
}

/**
 * The felt a game brings with it.
 *
 * Short Deck is played on a different table from Hold'em, so the GAME has an
 * opinion about the surface — but only as a default. A player who has picked a
 * felt of their own keeps it; see `useTableDesign.chosen`. Both matter, and the
 * player's choice is the one that wins.
 *
 * Matched on the variant NAME because that is what the snapshot carries
 * (`variant: this.spec.name`), not the config's variantId. A variant with no
 * entry here has no opinion, and the player's default stands.
 */
const VARIANT_DESIGN: Readonly<Record<string, string>> = {
  "Short Deck Hold'em": 'shortdeck-green',
};

export function designForVariant(variantName: string | null | undefined): TableDesign | null {
  if (!variantName) return null;
  const id = VARIANT_DESIGN[variantName];
  return id ? designById(id) : null;
}

/**
 * The seat ring for a table of `count` chairs. Sizes the design doesn't spell out fall back to an
 * even ring around a portrait oval, so an unusual table still seats everyone sensibly.
 */
export function ringFor(design: TableDesign, count: number): SeatPos[] {
  const ring = design.rings[count];
  if (ring) return ring;
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / count; // start at the bottom, run clockwise
    const left = 50 + 36 * Math.cos(angle);
    const top = 50 + 41 * Math.sin(angle);
    const align: SeatAlign = top > 72 ? 'bottom' : top < 28 ? 'top' : left < 50 ? 'left' : 'right';
    return { left: `${left}%`, top: `${top}%`, align };
  });
}

import type { ImageSourcePropType } from 'react-native';

/**
 * Table designs — the surfaces a player can choose between.
 *
 * A straight port of `frontend/src/lib/tableDesigns.ts`, numbers included, so a table looks the
 * same on a phone as it does in the Mini App. Copying the artwork without the seat ring would put
 * players floating off the rail, which is exactly what the web file warns about: the picture and
 * the positions measured off it are one thing, not two.
 *
 * The one platform difference is how the artwork is referenced. The web serves it from `/table/…`;
 * React Native bundles it, so `art` is a `require()` rather than a URL. Same images, same aspects.
 */

export type SeatAlign = 'bottom' | 'top' | 'left' | 'right';

export interface SeatPos {
  /** Percent of the table's width. */
  left: number;
  /** Percent of its height. */
  top: number;
  /** Which way the seat's chips and bubbles lean — outward from the middle. */
  align: SeatAlign;
}

export interface TableDesign {
  id: string;
  name: string;
  blurb: string;
  /** The bundled artwork, or null to draw the table from the brand palette. */
  art: ImageSourcePropType | null;
  /** width / height of the table area, matching the artwork. */
  aspect: number;
  /** Vertical centre of the board and pot, as a percentage of the table height. */
  boardTop: number;
  /** Seat rings by table size. Six is the house size; the others are drawn from it. */
  rings: Record<number, SeatPos[]>;
  /** Accent for seat rings and open-chair outlines on this felt. */
  accent: string;
}

/**
 * Six seats on a portrait stadium table: bottom-centre, then clockwise. The left/right pairs sit on
 * the straight sections of the rail, the other two at the rounded ends.
 */
function stadiumRings(edge: {
  x: number;
  yTop: number;
  yBottom: number;
  yMid: number;
}): Record<number, SeatPos[]> {
  const { x, yTop, yBottom, yMid } = edge;
  const right = 100 - x;
  const six: SeatPos[] = [
    { left: 50, top: yBottom, align: 'bottom' },
    { left: x, top: yMid + 12, align: 'left' },
    { left: x, top: yMid - 12, align: 'left' },
    { left: 50, top: yTop, align: 'top' },
    { left: right, top: yMid - 12, align: 'right' },
    { left: right, top: yMid + 12, align: 'right' },
  ];
  return {
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
    art: require('../../assets/table/midnight.png') as ImageSourcePropType,
    aspect: 512 / 768,
    boardTop: 50,
    accent: '#3b82f6',
    rings: stadiumRings({ x: 17, yTop: 12, yBottom: 92, yMid: 52 }),
  },
  {
    id: 'emerald',
    name: 'Emerald Classic',
    blurb: 'Casino green felt on a tournament rail',
    art: require('../../assets/table/emerald.png') as ImageSourcePropType,
    aspect: 941 / 1672,
    boardTop: 50,
    accent: '#34d399',
    rings: stadiumRings({ x: 14, yTop: 9, yBottom: 91, yMid: 50 }),
  },
  {
    id: 'neon',
    name: 'Neon Violet',
    blurb: 'Drawn from the brand palette — always available',
    art: null,
    aspect: 3 / 4,
    boardTop: 50,
    accent: '#bb5cf6',
    rings: stadiumRings({ x: 16, yTop: 10, yBottom: 90, yMid: 50 }),
  },
  {
    /*
     * THE RED ONE. The Mini App offers four colours and this client only had
     * three, so the swatch row was missing the red the reference table uses —
     * a player could not pick on their phone the table they had in Telegram.
     *
     * Same id as the web's, so the two share `GROUNDS` and a choice made on one
     * client means the same colour on the other.
     */
    id: 'house-maroon',
    name: 'House Maroon',
    blurb: 'Burgundy and gold, after the reference table',
    art: null,
    aspect: 3 / 4,
    boardTop: 50,
    accent: '#d9b87c',
    rings: stadiumRings({ x: 16, yTop: 10, yBottom: 90, yMid: 50 }),
  },
];

/**
 * GROUND COLOURS — what a "table design" means now.
 *
 * The felts are gone on both clients: a design no longer selects artwork or a
 * rail, it selects the colour of the plain ground the seats sit on. The seats
 * make the oval; nothing is drawn behind them.
 *
 * THE SAME TRIPLES AS THE MINI APP (`frontend/src/lib/tableDesigns.ts`), to the
 * hex. The two clients are one product and a player moving between them must
 * not find their green table is a different green — that is the whole reason
 * these are duplicated rather than each side picking its own.
 *
 * Inner, mid, outer: the radial stops, lightest at the centre.
 */
export const GROUNDS: Record<string, readonly [string, string, string]> = {
  midnight: ['#3a3f4a', '#262a33', '#14161b'],
  emerald: ['#1f5f4a', '#14402f', '#0a1f18'],
  neon: ['#1e4a8a', '#143363', '#0a1a33'],
  'house-maroon': ['#6d2230', '#4a1622', '#2a0d14'],
};

/** The red ground, for any design with no colour of its own. */
const DEFAULT_GROUND = GROUNDS['house-maroon']!;

/** The three radial stops for a design's ground. */
export function groundFor(design: TableDesign): readonly [string, string, string] {
  return GROUNDS[design.id] ?? DEFAULT_GROUND;
}

export const DEFAULT_DESIGN_ID = 'emerald';

export function designById(id: string): TableDesign {
  return TABLE_DESIGNS.find((d) => d.id === id) ?? TABLE_DESIGNS[1]!;
}

/**
 * The seat ring for a table of `count` players.
 *
 * Falls back to an even ellipse for sizes a design does not enumerate, so an unusual table still
 * seats everyone rather than stacking them at one position.
 */
export function ringFor(design: TableDesign, count: number): SeatPos[] {
  const ring = design.rings[count];
  if (ring) return ring;
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / count; // start at the bottom, run clockwise
    const left = 50 + 36 * Math.cos(angle);
    const top = 50 + 41 * Math.sin(angle);
    const align: SeatAlign = top > 72 ? 'bottom' : top < 28 ? 'top' : left < 50 ? 'left' : 'right';
    return { left, top, align };
  });
}

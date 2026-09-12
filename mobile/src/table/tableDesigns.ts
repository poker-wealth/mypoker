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
  /**
   * SEVEN AND EIGHT: three chairs down each straight rail, one on each curve.
   * Index order matches the web's — hero at 0, then bottom → left → top →
   * right — so a seat index means the same thing on both clients.
   */
  const eight: SeatPos[] = [
    { left: 50, top: yBottom, align: 'bottom' }, // 0 bottom centre — hero
    { left: x, top: yMid + 22, align: 'left' }, // 1 left lower
    { left: x, top: yMid, align: 'left' }, // 2 left middle
    { left: x, top: yMid - 22, align: 'left' }, // 3 left upper
    { left: 50, top: yTop, align: 'top' }, // 4 top centre
    { left: right, top: yMid - 22, align: 'right' }, // 5 right upper
    { left: right, top: yMid, align: 'right' }, // 6 right middle
    { left: right, top: yMid + 22, align: 'right' }, // 7 right lower
  ];

  /**
   * NINE — the HHPoker portrait ring. Mirror of the web's, to the number.
   *
   * Nine had no entry on either client, so a nine-handed table fell through to
   * the generic ellipse below: nine chairs evenly spaced around a CIRCLE on a
   * screen far taller than it is wide. Reported 12 Sep 2026 as "the seating
   * arrangement looks quite chaotic", and it was.
   *
   * The reference is a stadium: the hero alone on the bottom curve, three down
   * each rail, and TWO across the top straddling the centre — a single top-
   * centre seat would force four down one rail and three down the other.
   */
  const nine: SeatPos[] = [
    { left: 50, top: yBottom, align: 'bottom' }, // 0 bottom centre — hero
    { left: x + 2, top: yMid + 20, align: 'left' }, // 1 left lower
    { left: x, top: yMid, align: 'left' }, // 2 left middle
    { left: x + 2, top: yMid - 20, align: 'left' }, // 3 left upper
    { left: 34, top: yTop, align: 'top' }, // 4 top, left of centre
    { left: 66, top: yTop, align: 'top' }, // 5 top, right of centre
    { left: right - 2, top: yMid - 20, align: 'right' }, // 6 right upper
    { left: right, top: yMid, align: 'right' }, // 7 right middle
    { left: right - 2, top: yMid + 20, align: 'right' }, // 8 right lower
  ];

  const pick = (...i: number[]): SeatPos[] => i.map((n) => eight[n]!);

  return {
    2: [six[0]!, six[3]!],
    3: [six[0]!, six[2]!, six[4]!],
    4: [six[0]!, six[1]!, six[3]!, six[5]!],
    5: [six[0]!, six[1]!, six[2]!, six[4]!, six[5]!],
    6: six,
    // Symmetric about the hero: seven drops the right middle rather than
    // bunching the extra player down one rail.
    7: pick(0, 1, 2, 3, 4, 5, 7),
    8: pick(0, 1, 2, 3, 4, 5, 6, 7),
    9: nine,
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

  /*
   * A SIZE NOBODY MEASURED — laid out on the same stadium the measured rings
   * use, rather than on a circle. Mirror of the web's fallback.
   *
   * The ellipse this replaces is what made a nine-handed table look chaotic:
   * evenly spaced angles are right for a table seen from above and wrong for a
   * felt far taller than it is wide, so the chairs landed at points no rail
   * passes through.
   */
  const hero: SeatPos = { left: 50, top: 90, align: 'bottom' };
  if (count <= 1) return [hero];

  const sides = count - 1;
  const perRail = Math.floor((sides - (sides % 2 === 0 ? 2 : 1)) / 2);
  const topCount = sides - perRail * 2;

  const rail = (side: 'left' | 'right'): SeatPos[] =>
    Array.from({ length: perRail }, (_, i) => {
      const top = perRail === 1 ? 53 : 30 + (i * 46) / (perRail - 1);
      return {
        left: side === 'left' ? 11 : 89,
        top: side === 'left' ? 76 - (top - 30) : top,
        align: side as SeatAlign,
      };
    });

  const tops: SeatPos[] = Array.from({ length: topCount }, (_, i) => ({
    left: topCount === 1 ? 50 : 34 + i * (32 / (topCount - 1)),
    top: 11,
    align: 'top' as SeatAlign,
  }));

  // Bottom, up the left, across the top, down the right — the order every
  // measured ring uses, so a seat index means the same thing at any size.
  return [hero, ...rail('left'), ...tops, ...rail('right')];
}

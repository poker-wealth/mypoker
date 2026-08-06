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

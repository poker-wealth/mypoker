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
  /**
   * The LANDSCAPE counterpart of this felt, for games played on a wide table.
   *
   * The player picks the colour; the game picks the shape. Choosing Midnight
   * Blue and sitting at Short Deck or Omaha gives the blue WIDE table, not the
   * green one and not a portrait felt — their preference still means something,
   * it just gets rendered in the shape the game is played on.
   */
  wideId?: string;
  /**
   * Kept out of the picker. The wide counterparts are reached by choosing their
   * portrait sibling, so listing them separately would offer the same felt twice
   * and let someone pick a landscape table for a portrait game.
   */
  hidden?: boolean;
}

/**
 * Six seats on a portrait stadium table: bottom-centre, then clockwise. The left/right pairs sit at
 * the straight sections of the rail, the other two at the rounded ends.
 */
function stadiumRings(edge: { x: number; yTop: number; yBottom: number; yMid: number }): Record<number, SeatPos[]> {
  const { x, yTop, yBottom, yMid } = edge;
  const right = 100 - x;

  /**
   * The SIX-seat ring, measured against the artwork. Left exactly as it was.
   *
   * Every existing table is six-max, so these positions are the ones players
   * have actually been sitting on. The wider spread used for seven and eight
   * below is a separate array rather than a re-tuning of this one, so adding the
   * bigger sizes cannot move anybody who is already seated.
   */
  const six: SeatPos[] = [
    { left: '50%', top: `${yBottom}%`, align: 'bottom' },
    { left: `${x}%`, top: `${yMid + 12}%`, align: 'left' },
    { left: `${x}%`, top: `${yMid - 12}%`, align: 'left' },
    { left: '50%', top: `${yTop}%`, align: 'top' },
    { left: `${right}%`, top: `${yMid - 12}%`, align: 'right' },
    { left: `${right}%`, top: `${yMid + 12}%`, align: 'right' },
  ];

  /**
   * EIGHT on the portrait felt: three down each long rail, plus the two rounded
   * ends. On a tall stadium the LEFT and RIGHT edges are the straights, so that
   * is where the extra chairs go — the top and bottom are curves and hold one
   * each.
   *
   * Index order matches `wideRings`: hero at 0, bottom-centre, running
   * bottom → left → top → right, so a seat index means the same thing on both
   * felts.
   *
   * ⚠️ These offsets are DERIVED (±22 and the midpoint) rather than measured off
   * the artwork the way `six` was. They should be checked on a device before
   * anyone calls the eight-max felt finished — the middle pair especially, since
   * it is the one position with no equivalent in the six-max ring.
   */
  const eight: SeatPos[] = [
    { left: '50%', top: `${yBottom}%`, align: 'bottom' }, // 0 bottom centre — hero
    { left: `${x}%`, top: `${yMid + 22}%`, align: 'left' }, // 1 left lower
    { left: `${x}%`, top: `${yMid}%`, align: 'left' }, // 2 left middle
    { left: `${x}%`, top: `${yMid - 22}%`, align: 'left' }, // 3 left upper
    { left: '50%', top: `${yTop}%`, align: 'top' }, // 4 top centre
    { left: `${right}%`, top: `${yMid - 22}%`, align: 'right' }, // 5 right upper
    { left: `${right}%`, top: `${yMid}%`, align: 'right' }, // 6 right middle
    { left: `${right}%`, top: `${yMid + 22}%`, align: 'right' }, // 7 right lower
  ];
  const pick = (...i: number[]): SeatPos[] => i.map((n) => eight[n]!);

  return {
    2: [six[0]!, six[3]!],
    3: [six[0]!, six[2]!, six[4]!],
    4: [six[0]!, six[1]!, six[3]!, six[5]!],
    5: [six[0]!, six[1]!, six[2]!, six[4]!, six[5]!],
    6: six,
    // Symmetric about the hero, like every other size: seven drops the right
    // middle rather than bunching the extra player down one rail.
    7: pick(0, 1, 2, 3, 4, 5, 7),
    8: pick(0, 1, 2, 3, 4, 5, 6, 7),
  };
}

/**
 * EIGHT seats on a LANDSCAPE stadium table, following the chairs the artwork
 * actually draws: three cushion segments along the bottom rail, three along the
 * top, and one at each rounded end.
 *
 * Not a rotation of `stadiumRings`. That one puts its side pairs on the long
 * straight edges, which on a wide table are the top and bottom — so reusing it
 * here would drop four players into the middle of the felt.
 *
 * Hero is always index 0, bottom-centre, and the ring runs the same direction
 * as the portrait one: bottom → left → top → right.
 */
function wideRings(edge: {
  /** Horizontal inset of the rail seats, as a % of width. */
  x: number;
  /** Horizontal inset of the two END seats — further out, on the curve. */
  endX: number;
  yTop: number;
  yBottom: number;
}): Record<number, SeatPos[]> {
  const { x, endX, yTop, yBottom } = edge;
  const right = 100 - x;
  const endRight = 100 - endX;
  // Rail seats either side of centre sit slightly inboard, following the curve
  // of the oval rather than a straight line.
  const yTopOuter = yTop + 6;
  const yBottomOuter = yBottom - 6;
  const eight: SeatPos[] = [
    { left: '50%', top: `${yBottom}%`, align: 'bottom' }, // 0 bottom centre — hero
    { left: `${x}%`, top: `${yBottomOuter}%`, align: 'bottom' }, // 1 bottom left
    { left: `${endX}%`, top: '50%', align: 'left' }, // 2 left end cap
    { left: `${x}%`, top: `${yTopOuter}%`, align: 'top' }, // 3 top left
    { left: '50%', top: `${yTop}%`, align: 'top' }, // 4 top centre
    { left: `${right}%`, top: `${yTopOuter}%`, align: 'top' }, // 5 top right
    { left: `${endRight}%`, top: '50%', align: 'right' }, // 6 right end cap
    { left: `${right}%`, top: `${yBottomOuter}%`, align: 'bottom' }, // 7 bottom right
  ];
  const pick = (...i: number[]): SeatPos[] => i.map((n) => eight[n]!);
  return {
    // Every size stays symmetric about the hero, so a short-handed table reads
    // as a table rather than as everyone bunched down one end.
    2: pick(0, 4), // heads-up faces you across the felt
    3: pick(0, 3, 5),
    4: pick(0, 2, 4, 6), // the four compass points
    5: pick(0, 1, 3, 5, 7),
    6: pick(0, 1, 3, 4, 5, 7), // three along each long rail
    7: pick(0, 1, 2, 3, 4, 5, 7),
    8: eight,
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
    wideId: 'wide-blue',
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
    wideId: 'wide-green',
    rings: stadiumRings({ x: 14, yTop: 9, yBottom: 91, yMid: 50 }),
  },
  /**
   * The two LANDSCAPE felts — used by Short Deck and Omaha. Named for their
   * shape rather than a game, because they serve more than one: the files are
   * still `shortdeck-*.png` from when Short Deck was the only wide game.
   *
   * The art is `table.png` turned on its side (1672×941 against its 941×1672),
   * so the seat ring comes from `wideRings` rather than `stadiumRings`.
   *
   * EIGHT seats: three cushion segments along each long rail plus a rounded end
   * cap either side, which is what the artwork actually draws.
   *
   * Both are `hidden` — they are not picked directly. A player chooses Midnight
   * Blue or Emerald Classic and `designForGame` swaps in the matching wide felt
   * when the game is played on one. The colour is theirs; the shape is the
   * game's.
   */
  {
    id: 'wide-green',
    name: 'Wide Green',
    blurb: 'Landscape eight-seat felt, classic casino green',
    artUrl: '/table/shortdeck-green.png',
    aspect: '1672 / 941',
    boardTop: '50%',
    accent: '#34d399',
    hidden: true,
    rings: wideRings({ x: 26, endX: 6, yTop: 13, yBottom: 87 }),
  },
  {
    id: 'wide-blue',
    name: 'Wide Blue',
    blurb: 'The same landscape felt in tournament blue',
    artUrl: '/table/shortdeck-blue.png',
    aspect: '1672 / 941',
    boardTop: '50%',
    accent: '#3b82f6',
    hidden: true,
    rings: wideRings({ x: 26, endX: 6, yTop: 13, yBottom: 87 }),
  },
  {
    id: 'neon',
    name: 'Neon Violet',
    blurb: 'Drawn in CSS from the brand palette — always available',
    artUrl: null,
    aspect: '3 / 4',
    boardTop: '50%',
    accent: 'var(--accent)',
    // No violet wide art exists, so a Neon player gets the blue landscape felt —
    // the nearer of the two to the brand.
    wideId: 'wide-blue',
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
      // Seven and eight: three down each rail, tucked outward at the waist
      // where the oval is widest (11% / 89%) and inward at the ends where it
      // curves. Neon is drawn in CSS rather than from artwork, so these are
      // free to sit wherever the shape wants them.
      7: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '13%', top: '72%', align: 'left' },
        { left: '11%', top: '50%', align: 'left' },
        { left: '13%', top: '26%', align: 'left' },
        { left: '50%', top: '10%', align: 'top' },
        { left: '87%', top: '26%', align: 'right' },
        { left: '87%', top: '72%', align: 'right' },
      ],
      8: [
        { left: '50%', top: '89%', align: 'bottom' },
        { left: '13%', top: '72%', align: 'left' },
        { left: '11%', top: '50%', align: 'left' },
        { left: '13%', top: '26%', align: 'left' },
        { left: '50%', top: '10%', align: 'top' },
        { left: '87%', top: '26%', align: 'right' },
        { left: '89%', top: '50%', align: 'right' },
        { left: '87%', top: '72%', align: 'right' },
      ],
    },
  },
];

export const DEFAULT_DESIGN_ID = 'midnight';

export function designById(id: string | null | undefined): TableDesign {
  return TABLE_DESIGNS.find((d) => d.id === id) ?? TABLE_DESIGNS[0]!;
}

/**
 * The felt a game is PLAYED ON, where the game has an opinion.
 *
 * Short Deck is a different table from Hold'em — not a skin of it — so this
 * WINS over the player's picker choice rather than merely defaulting when they
 * have not made one. An earlier version deferred to any stored preference,
 * which meant anyone who had ever opened the design picker never saw the Short
 * Deck felt at all: almost everyone, since the default itself is stored.
 *
 * A game with no entry here has no opinion and the player's choice stands, so
 * Hold'em and Omaha are untouched.
 *
 * Keyed on the TABLE ID, which is exact, rather than the variant's display name
 * — the snapshot carries `variant: this.spec.name`, and matching prose is one
 * apostrophe away from silently never matching. The name is accepted as a
 * fallback for tables whose id does not name the game.
 */
/**
 * Games played on the WIDE felt, by table id and by variant display name.
 *
 * Hold'em keeps the portrait table; the variants get the landscape one. Both
 * ids and names are listed because a fixed table's id names the game while a
 * player-created one does not, and the snapshot carries the variant's display
 * name rather than its id.
 */
const WIDE_GAMES: readonly string[] = [
  'short-deck',
  "Short Deck Hold'em",
  'omaha',
  'Omaha',
];

/**
 * The felt to render, given the game AND what the player likes.
 *
 * The player picks the COLOUR, the game picks the SHAPE. Short Deck is played
 * on a wide table, so a player on Midnight Blue gets the blue WIDE felt — not
 * the green one, and not a portrait table. Their choice still means something;
 * it is simply drawn in the shape the game is played on.
 *
 * Null when the game has no shape of its own, which leaves the chosen felt
 * exactly as it is — Hold'em and Omaha are untouched.
 *
 * Matched on the TABLE ID first, which is exact. A player-created table is
 * `<game>-<uuid>`, so the prefix keeps custom Short Deck tables on a wide felt.
 * The variant's display name is a fallback for ids that do not name the game.
 */
export function designForGame(
  tableId: string | null | undefined,
  variantName: string | null | undefined,
  chosen: TableDesign,
): TableDesign | null {
  const isWideGame =
    WIDE_GAMES.some((key) => tableId === key || tableId?.startsWith(`${key}-`)) ||
    (variantName ? WIDE_GAMES.includes(variantName) : false);
  if (!isWideGame) return null;

  // Already a wide felt (they chose one directly, or a previous session stored
  // it) — leave it alone rather than bouncing through the mapping.
  if (chosen.hidden) return chosen;
  return chosen.wideId ? designById(chosen.wideId) : null;
}

/** The felts a player may actually pick. Wide counterparts are reached through their sibling. */
export const PICKABLE_DESIGNS = TABLE_DESIGNS.filter((d) => !d.hidden);

/**
 * The seat ring for a table of `count` chairs. Sizes the design doesn't spell out fall back to an
 * even ring around a portrait oval, so an unusual table still seats everyone sensibly.
 */
/** The largest seat count this felt has a real, hand-placed ring for. */
function ringCeiling(design: TableDesign): number {
  return Math.max(...Object.keys(design.rings).map(Number));
}

/**
 * The most chairs a table of this game may have — DERIVED from the artwork,
 * not declared.
 *
 * Each design places seats per count and then stops: the portrait stadium felt
 * at six, the wide landscape felt at eight. Above that `ringFor` falls back to
 * an evenly-spaced circle, which on an oval felt seats people in the middle of
 * the table instead of on the rail. Nothing throws — it just looks broken.
 *
 * Taken as the MINIMUM across every felt the game could be played on, because a
 * player picks their own design where the game has no opinion, and a table must
 * render on whichever they picked.
 *
 * The server keeps its own copy in `PokerVariant.maxSeats` and refuses anything
 * above it; `test/lobby/seat-caps.test.ts` pins that side. This is the side that
 * knows why the number is what it is.
 */
export function seatCapFor(gameOrVariant: string | null | undefined): number {
  const forced = designForGame(gameOrVariant, undefined, designById(DEFAULT_DESIGN_ID));
  const candidates = forced ? [forced] : PICKABLE_DESIGNS;
  return Math.min(...candidates.map(ringCeiling));
}

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

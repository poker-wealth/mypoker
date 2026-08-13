import { seat, snap, type DemoScript } from './script';

/**
 * THROWAWAY DEMO — one scripted round per game. See `script.ts` for what these are.
 *
 * Each script is the shape of a real round: who is at the table, what they stake, what comes out,
 * who wins and what it pays. Short on purpose — this is a walkthrough, not a simulator.
 */

const holdem: DemoScript = {
  tableId: 'texas',
  title: "Texas Hold'em",
  premise: 'Two cards each, five on the table. Best five-card hand takes the pot.',
  steps: [
    {
      caption: 'Blinds are posted and everyone is dealt two cards, face down to everyone but them.',
      snapshot: snap({
        tableId: 'texas',
        name: "Hold'em · ₮0.10/0.20",
        variant: "Texas Hold'em",
        street: 'PREFLOP',
        pot: 30,
        toActSeat: 0,
        legal: { canFold: true, canCheck: false, callAmount: 20, minRaiseTo: 40, maxRaiseTo: 2000 },
        seats: [
          seat({ index: 0, name: 'You', stack: 1980, bet: 20, cards: ['Ah', 'Kh'], isYou: true, status: 'active' }),
          seat({ index: 1, name: 'Bruno', stack: 1990, bet: 10, cards: [null, null], isDealer: true, lastAction: 'Small blind' }),
          seat({ index: 2, name: 'Mei', stack: 2000, cards: [null, null] }),
        ],
      }),
    },
    {
      caption: 'You call. The flop comes — and you have two hearts working.',
      snapshot: snap({
        tableId: 'texas',
        name: "Hold'em · ₮0.10/0.20",
        variant: "Texas Hold'em",
        street: 'FLOP',
        pot: 60,
        board: ['Qh', '7h', '2c'],
        toActSeat: 1,
        seats: [
          seat({ index: 0, name: 'You', stack: 1980, cards: ['Ah', 'Kh'], isYou: true, status: 'active', lastAction: 'Call' }),
          seat({ index: 1, name: 'Bruno', stack: 1980, cards: [null, null], isDealer: true, status: 'active' }),
          seat({ index: 2, name: 'Mei', stack: 2000, cards: [], status: 'folded', lastAction: 'Fold' }),
        ],
      }),
    },
    {
      caption: 'The river brings a fourth heart. Your flush is made.',
      snapshot: snap({
        tableId: 'texas',
        name: "Hold'em · ₮0.10/0.20",
        variant: "Texas Hold'em",
        street: 'RIVER',
        pot: 260,
        board: ['Qh', '7h', '2c', '9d', '4h'],
        toActSeat: 0,
        legal: { canFold: true, canCheck: true, callAmount: null, minRaiseTo: 20, maxRaiseTo: 1880 },
        seats: [
          seat({ index: 0, name: 'You', stack: 1880, cards: ['Ah', 'Kh'], isYou: true, status: 'active' }),
          seat({ index: 1, name: 'Bruno', stack: 1880, cards: [null, null], isDealer: true, status: 'active', lastAction: 'Check' }),
          seat({ index: 2, name: 'Mei', stack: 2000, cards: [], status: 'folded' }),
        ],
      }),
    },
    {
      caption: 'Showdown. Both hands turn over, the pot goes to the flush, and the rake comes out.',
      holdMs: 5_000,
      snapshot: snap({
        tableId: 'texas',
        name: "Hold'em · ₮0.10/0.20",
        variant: "Texas Hold'em",
        phase: 'SHOWDOWN',
        street: 'SHOWDOWN',
        board: ['Qh', '7h', '2c', '9d', '4h'],
        message: 'You win ₮247 with a Flush',
        seats: [
          seat({ index: 0, name: 'You', stack: 2127, cards: ['Ah', 'Kh'], isYou: true, isWinner: true }),
          seat({ index: 1, name: 'Bruno', stack: 1880, cards: ['Qs', 'Jd'], isDealer: true }),
          seat({ index: 2, name: 'Mei', stack: 2000, cards: [] }),
        ],
      }),
    },
  ],
};

const baccarat: DemoScript = {
  tableId: 'baccarat',
  title: 'Baccarat',
  premise:
    'A seated player banks the round; everyone else backs Player, Banker or Tie against them. The house only takes a rake.',
  steps: [
    {
      caption: 'Betting is open. Bruno is banking this round, so he does not bet.',
      snapshot: snap({
        tableId: 'baccarat',
        name: 'Baccarat · Player Banked',
        variant: 'Baccarat',
        maxSeats: 6,
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 4000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, isYou: true }),
          seat({ index: 2, name: 'Mei', stack: 1800 }),
        ],
      }),
    },
    {
      caption: 'You back Player for ₮200. Mei backs Banker.',
      snapshot: snap({
        tableId: 'baccarat',
        name: 'Baccarat · Player Banked',
        variant: 'Baccarat',
        maxSeats: 6,
        pot: 400,
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 4000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, bet: 200, isYou: true, status: 'active', lastAction: 'PLAYER ₮200' }),
          seat({ index: 2, name: 'Mei', stack: 1800, bet: 200, status: 'active', lastAction: 'BANKER ₮200' }),
        ],
      }),
    },
    {
      caption: 'The cards are dealt from the provably-fair shuffle: Player 8, Banker 6.',
      holdMs: 5_000,
      snapshot: snap({
        tableId: 'baccarat',
        name: 'Baccarat · Player Banked',
        variant: 'Baccarat',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        board: ['5h', '3s', '|', 'Kd', '6c'],
        message: 'Outcome: PLAYER (P: 8 vs B: 6)',
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 3800, isDealer: true }),
          seat({ index: 1, name: 'You', stack: 2190, isYou: true, isWinner: true, lastAction: 'won ₮190' }),
          seat({ index: 2, name: 'Mei', stack: 1600, lastAction: 'lost ₮200' }),
        ],
      }),
    },
    {
      caption:
        'Bruno paid you as the banker and collected from Mei. The platform took ₮10 rake — it is never a party to the bet.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'baccarat',
        name: 'Baccarat · Player Banked',
        variant: 'Baccarat',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        board: ['5h', '3s', '|', 'Kd', '6c'],
        message: 'Σ losers ₮200 = Σ winners ₮190 + rake ₮10',
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 3800, isDealer: true }),
          seat({ index: 1, name: 'You', stack: 2190, isYou: true, isWinner: true }),
          seat({ index: 2, name: 'Mei', stack: 1600 }),
        ],
      }),
    },
  ],
};

const niuNiu: DemoScript = {
  tableId: 'niu-niu',
  title: 'Niu Niu',
  premise:
    'Five cards each. Players race to claim the bank, then everyone else plays their hand against the banker.',
  steps: [
    {
      caption: 'The bank is open — first claim takes it. Mei gets there first.',
      snapshot: snap({
        tableId: 'niu-niu',
        name: 'Niu Niu · Player Banked',
        variant: 'Niu Niu',
        maxSeats: 6,
        seats: [
          seat({ index: 0, name: 'Mei', stack: 5000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, isYou: true }),
          seat({ index: 2, name: 'Bruno', stack: 2400 }),
        ],
      }),
    },
    {
      caption: 'You stake ₮150 against her.',
      snapshot: snap({
        tableId: 'niu-niu',
        name: 'Niu Niu · Player Banked',
        variant: 'Niu Niu',
        maxSeats: 6,
        pot: 300,
        seats: [
          seat({ index: 0, name: 'Mei', stack: 5000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, bet: 150, isYou: true, status: 'active' }),
          seat({ index: 2, name: 'Bruno', stack: 2400, bet: 150, status: 'active' }),
        ],
      }),
    },
    {
      caption: 'Hands turn over. Yours makes Niu 9 — a three-times multiplier against the bank.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'niu-niu',
        name: 'Niu Niu · Player Banked',
        variant: 'Niu Niu',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        message: 'You win ₮427 — Niu 9 (×3)',
        seats: [
          seat({ index: 0, name: 'Mei', stack: 4550, isDealer: true, cards: ['5c', '5d', '9s', 'Kh', 'Qd'] }),
          seat({ index: 1, name: 'You', stack: 2427, isYou: true, isWinner: true, cards: ['Th', 'Js', '4d', '2c', '3h'] }),
          seat({ index: 2, name: 'Bruno', stack: 2250, cards: ['7s', '8d', '3c', 'Kc', 'Qs'] }),
        ],
      }),
    },
  ],
};

const sanZhang: DemoScript = {
  tableId: 'san-zhang',
  title: 'San Zhang · Zha Jin Hua',
  premise: 'Three cards each, straight compare against the banker. Simple and fast.',
  steps: [
    {
      caption: 'Stakes go up against the banker.',
      snapshot: snap({
        tableId: 'san-zhang',
        name: 'San Zhang · Player Banked',
        variant: 'San Zhang',
        maxSeats: 6,
        pot: 200,
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 4000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, bet: 100, isYou: true, status: 'active' }),
          seat({ index: 2, name: 'Mei', stack: 1900, bet: 100, status: 'active' }),
        ],
      }),
    },
    {
      caption: 'Three cards each, compared to the banker. A straight flush beats his pair.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'san-zhang',
        name: 'San Zhang · Player Banked',
        variant: 'San Zhang',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        message: 'You win ₮95 — Straight Flush',
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 3900, isDealer: true, cards: ['9c', '9d', '4s'] }),
          seat({ index: 1, name: 'You', stack: 2095, isYou: true, isWinner: true, cards: ['7h', '8h', '9h'] }),
          seat({ index: 2, name: 'Mei', stack: 1800, cards: ['2c', '5d', 'Js'] }),
        ],
      }),
    },
  ],
};

const redPacket: DemoScript = {
  tableId: 'red-packet',
  title: 'Red Packet Minesweeper',
  premise: 'Everyone stakes a square on the grid. The mines are revealed after the bets are in.',
  steps: [
    {
      caption: 'The grid is committed before anyone bets — the mines are already fixed and hidden.',
      snapshot: snap({
        tableId: 'red-packet',
        name: 'Red Packet Minesweeper',
        variant: 'Red Packet',
        maxSeats: 6,
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 4000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, isYou: true }),
          seat({ index: 2, name: 'Mei', stack: 1500 }),
        ],
      }),
    },
    {
      caption: 'You take square 7 for ₮100. Mei takes square 19.',
      snapshot: snap({
        tableId: 'red-packet',
        name: 'Red Packet Minesweeper',
        variant: 'Red Packet',
        maxSeats: 6,
        pot: 200,
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 4000, isDealer: true, lastAction: 'BANKER' }),
          seat({ index: 1, name: 'You', stack: 2000, bet: 100, isYou: true, status: 'active', lastAction: 'cell 7' }),
          seat({ index: 2, name: 'Mei', stack: 1500, bet: 100, status: 'active', lastAction: 'cell 19' }),
        ],
      }),
    },
    {
      caption: 'Revealed: square 19 was a mine. Yours was clean, so the banker pays you and collects from Mei.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'red-packet',
        name: 'Red Packet Minesweeper',
        variant: 'Red Packet',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        board: ['3', '11', '19', '22', '24'],
        message: 'Mines: 3, 11, 19, 22, 24 — you swept a clean square',
        seats: [
          seat({ index: 0, name: 'Bruno', stack: 4005, isDealer: true }),
          seat({ index: 1, name: 'You', stack: 2095, isYou: true, isWinner: true }),
          seat({ index: 2, name: 'Mei', stack: 1400 }),
        ],
      }),
    },
  ],
};

const cowboy: DemoScript = {
  tableId: 'cowboy-beauty',
  title: 'Cowboy & Beauty',
  premise:
    'Back one of two sides. Everything staked forms one pool, the winning side splits it, and the odds freeze five seconds before the draw.',
  steps: [
    {
      caption: 'Bets are open on both sides. The odds move as the pool fills.',
      snapshot: snap({
        tableId: 'cowboy-beauty',
        name: 'Cowboy & Beauty',
        variant: 'Cowboy & Beauty',
        maxSeats: 6,
        pot: 500,
        seats: [
          seat({ index: 0, name: 'You', stack: 2000, bet: 200, isYou: true, status: 'active', lastAction: 'COWBOY ₮200' }),
          seat({ index: 1, name: 'Mei', stack: 1800, bet: 200, status: 'active', lastAction: 'BEAUTY ₮200' }),
          seat({ index: 2, name: 'Bruno', stack: 2600, bet: 100, status: 'active', lastAction: 'COWBOY ₮100' }),
        ],
      }),
    },
    {
      caption: 'T-5 seconds: the odds freeze. No late money can move them.',
      snapshot: snap({
        tableId: 'cowboy-beauty',
        name: 'Cowboy & Beauty',
        variant: 'Cowboy & Beauty',
        maxSeats: 6,
        pot: 500,
        message: 'Odds frozen — Cowboy 1.63 · Beauty 2.38',
        seats: [
          seat({ index: 0, name: 'You', stack: 2000, bet: 200, isYou: true, status: 'active' }),
          seat({ index: 1, name: 'Mei', stack: 1800, bet: 200, status: 'active' }),
          seat({ index: 2, name: 'Bruno', stack: 2600, bet: 100, status: 'active' }),
        ],
      }),
    },
    {
      caption: 'Cowboy draws the higher card. The pool splits between the two who backed it, less rake.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'cowboy-beauty',
        name: 'Cowboy & Beauty',
        variant: 'Cowboy & Beauty',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        board: ['Kd', '7s'],
        message: 'COWBOY wins — K beats 7',
        seats: [
          seat({ index: 0, name: 'You', stack: 2127, isYou: true, isWinner: true }),
          seat({ index: 1, name: 'Mei', stack: 1600 }),
          seat({ index: 2, name: 'Bruno', stack: 2663, isWinner: true }),
        ],
      }),
    },
  ],
};

const douDiZhu: DemoScript = {
  tableId: 'dou-di-zhu',
  title: 'Dou Di Zhu · Fight the Landlord',
  premise:
    'Three players bid for the landlord’s chair and the three bonus cards. Landlord plays alone against the other two; first to empty their hand wins.',
  steps: [
    {
      caption: 'Seventeen cards each, three face down. The auction opens.',
      snapshot: snap({
        tableId: 'dou-di-zhu',
        name: 'Dou Di Zhu · Fight the Landlord',
        variant: 'Dou Di Zhu',
        maxSeats: 3,
        stage: 'BIDDING',
        toActSeat: 0,
        seats: [
          seat({ index: 0, name: 'You', stack: 2000, isYou: true, cards: ['3s', '4h', '7d', '9c', 'Ts', 'Jh', 'Qd', 'Kc', 'As', '2h'] }),
          seat({ index: 1, name: 'Mei', stack: 2000, cards: Array.from({ length: 17 }, () => null) }),
          seat({ index: 2, name: 'Bruno', stack: 2000, cards: Array.from({ length: 17 }, () => null) }),
        ],
      }),
    },
    {
      caption: 'You bid 2 and take the chair — plus the three bonus cards, twenty in hand.',
      snapshot: snap({
        tableId: 'dou-di-zhu',
        name: 'Dou Di Zhu · Fight the Landlord',
        variant: 'Dou Di Zhu',
        maxSeats: 3,
        stage: 'PLAYING',
        toActSeat: 0,
        seats: [
          seat({ index: 0, name: 'You', stack: 2000, isYou: true, isDealer: true, lastAction: 'LANDLORD', cards: ['3s', '4h', '7d', '9c', 'Ts', 'Jh', 'Qd', 'Kc', 'As', '2h', 'jb'] }),
          seat({ index: 1, name: 'Mei', stack: 2000, cards: Array.from({ length: 17 }, () => null) }),
          seat({ index: 2, name: 'Bruno', stack: 2000, cards: Array.from({ length: 17 }, () => null) }),
        ],
      }),
    },
    {
      caption: 'You lead a pair. Each player in turn must beat it or pass.',
      snapshot: snap({
        tableId: 'dou-di-zhu',
        name: 'Dou Di Zhu · Fight the Landlord',
        variant: 'Dou Di Zhu',
        maxSeats: 3,
        stage: 'PLAYING',
        board: ['9c', '9h'],
        toActSeat: 1,
        seats: [
          seat({ index: 0, name: 'You', stack: 2000, isYou: true, isDealer: true, cards: ['3s', '4h', '7d', 'Ts', 'Jh', 'Qd', 'Kc', 'As', '2h', 'jb'] }),
          seat({ index: 1, name: 'Mei', stack: 2000, status: 'active', cards: Array.from({ length: 15 }, () => null) }),
          seat({ index: 2, name: 'Bruno', stack: 2000, cards: Array.from({ length: 16 }, () => null) }),
        ],
      }),
    },
    {
      caption:
        'You empty your hand first. The landlord plays for double, so each peasant pays twice the stake.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'dou-di-zhu',
        name: 'Dou Di Zhu · Fight the Landlord',
        variant: 'Dou Di Zhu',
        phase: 'SHOWDOWN',
        maxSeats: 3,
        message: 'You win — Landlord',
        seats: [
          seat({ index: 0, name: 'You', stack: 2380, isYou: true, isDealer: true, isWinner: true, cards: [] }),
          seat({ index: 1, name: 'Mei', stack: 1800, cards: Array.from({ length: 4 }, () => null) }),
          seat({ index: 2, name: 'Bruno', stack: 1800, cards: Array.from({ length: 6 }, () => null) }),
        ],
      }),
    },
  ],
};

const lottery: DemoScript = {
  tableId: 'lottery',
  title: 'Lottery Draw',
  premise: 'Pick a number, buy a ticket. Every stake forms one pool; whoever picked the drawn number takes it.',
  steps: [
    {
      caption: 'Tickets are on sale. You take number 7.',
      snapshot: snap({
        tableId: 'lottery',
        name: 'Lottery Draw',
        variant: 'Lottery',
        maxSeats: 6,
        pot: 300,
        seats: [
          seat({ index: 0, name: 'You', stack: 2000, bet: 100, isYou: true, status: 'active', lastAction: '#7 (₮100)' }),
          seat({ index: 1, name: 'Mei', stack: 1500, bet: 100, status: 'active', lastAction: '#3 (₮100)' }),
          seat({ index: 2, name: 'Bruno', stack: 2200, bet: 100, status: 'active', lastAction: '#7 (₮100)' }),
        ],
      }),
    },
    {
      caption: 'The draw comes from the committed seed: number 7. You and Bruno split the pool, less rake.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'lottery',
        name: 'Lottery Draw',
        variant: 'Lottery',
        phase: 'SHOWDOWN',
        maxSeats: 6,
        board: ['7'],
        message: 'Drawn: 7',
        seats: [
          seat({ index: 0, name: 'You', stack: 2047, isYou: true, isWinner: true }),
          seat({ index: 1, name: 'Mei', stack: 1400 }),
          seat({ index: 2, name: 'Bruno', stack: 2247, isWinner: true }),
        ],
      }),
    },
  ],
};

const slots: DemoScript = {
  tableId: 'slots',
  title: 'Slot Machines',
  premise:
    'A single-player spin. The outcome comes from an outside provider, signed — our side pays out only what the signature proves.',
  steps: [
    {
      caption: 'You stake ₮100 on a spin.',
      snapshot: snap({
        tableId: 'slots',
        name: 'Classic Slots',
        variant: 'Slots',
        maxSeats: 1,
        seats: [seat({ index: 0, name: 'You', stack: 2000, bet: 100, isYou: true, status: 'active' })],
      }),
    },
    {
      caption: 'The provider returns a signed result. Two cherries — ₮250 back.',
      holdMs: 6_000,
      snapshot: snap({
        tableId: 'slots',
        name: 'Classic Slots',
        variant: 'Slots',
        phase: 'SHOWDOWN',
        maxSeats: 1,
        message: 'Win ₮250',
        seats: [seat({ index: 0, name: 'You', stack: 2150, isYou: true, isWinner: true })],
      }),
    },
  ],
};

/** Every game, in the order a demo should walk them. */
export const DEMO_SCRIPTS: DemoScript[] = [
  holdem,
  baccarat,
  niuNiu,
  sanZhang,
  douDiZhu,
  redPacket,
  cowboy,
  lottery,
  slots,
];

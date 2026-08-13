import { ChipBank } from '../src/live/chip-bank';
import { DevPlayers } from '../src/live/players';
import { createRoom, type LiveRoom, type LiveTableConfig } from '../src/live/live-room';
import { defaultTables } from '../src/live/server';
import '../src/live/rooms';
import type { TableCommand, TableSnapshot } from '../src/live/room-state';

/**
 * Can ONE person walk up to each table and play a round?   npm run demo-readiness
 *
 * That is the question a demo asks, and it is not the question the room tests ask — they seat as
 * many players as each game needs. Most of these games need a counterparty (a banker to bet
 * against, another ticket in the pool), so a lone visitor cannot start them at all.
 *
 * This drives every table in `defaultTables()` the way the app does — sit, then the game's own
 * move — and reports what a single user would actually see.
 */

const BUY_IN = 2_000;
const wait = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

/**
 * The move a lone player makes at each GAME, in that game's own vocabulary. Keyed by game rather
 * than table id so a practice table (`<game>-ai`) is probed exactly like its real counterpart.
 */
const FIRST_MOVE: Record<string, TableCommand | null> = {
  texas: null, // poker acts only when it is your turn
  'short-deck': null,
  omaha: null,
  baccarat: { kind: 'act', action: { type: 'player', amount: 100 } },
  'niu-niu': { kind: 'act', action: { type: 'bet', amount: 100 } },
  'san-zhang': { kind: 'act', action: { type: 'bet', amount: 100 } },
  'red-packet': { kind: 'act', action: { type: '3', amount: 100 } },
  'cowboy-beauty': { kind: 'act', action: { type: 'cowboy', amount: 100 } },
  'dou-di-zhu': { kind: 'act', action: { type: 'bid-2' } },
  lottery: { kind: 'act', action: { type: '3', amount: 100 } },
  slots: { kind: 'act', action: { type: 'spin', amount: 100 } },
};

/**
 * Take the visitor's turn, if the table is waiting on them.
 *
 * The dumbest legal move in each game — check/call at poker, bid then lead low at Dou Di Zhu — is
 * all this needs: the question is whether a round can be completed at all, not whether it is
 * completed well. Returns false when it is nobody's turn or not ours.
 */
async function takeTurnIfOurs(room: LiveRoom, me: string, game: string): Promise<boolean> {
  const snap = room.snapshotFor(me);
  if (snap.phase !== 'IN_HAND') return false;
  const mine = snap.seats.find((s) => s.isYou);
  if (!mine || snap.toActSeat !== mine.index) return false;

  if (game === 'texas' || game === 'short-deck' || game === 'omaha') {
    if (!snap.legal) return false;
    const action = snap.legal.canCheck ? { type: 'check' } : { type: 'call' };
    await room.command(me, { kind: 'act', action }).catch(() => {});
    return true;
  }

  if (game === 'dou-di-zhu') {
    if (snap.stage === 'BIDDING') {
      await room.command(me, { kind: 'act', action: { type: 'bid-1' } }).catch(() => {});
      return true;
    }
    const hand = mine.cards.filter((c): c is string => typeof c === 'string');
    const move: TableCommand =
      snap.board.length === 0
        ? { kind: 'act', action: { type: 'play', cards: [hand[0]!] } }
        : { kind: 'act', action: { type: 'pass' } };
    await room.command(me, move).catch(() => {});
    return true;
  }

  return false;
}

interface Report {
  table: string;
  game: string;
  seated: boolean;
  dealt: boolean;
  moved: boolean;
  settled: boolean;
  note: string;
}

async function probe(config: LiveTableConfig): Promise<Report> {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const me = players.create('Solo Visitor').id;
  const report: Report = {
    table: String(config.id),
    game: String(config.game),
    seated: false,
    dealt: false,
    moved: false,
    settled: false,
    note: '',
  };

  let room: LiveRoom;
  try {
    room = createRoom(config, { directory: players, fc: bank });
  } catch (err) {
    report.note = `room would not build: ${(err as Error).message}`;
    return report;
  }

  room.join(me, { sendSnapshot: () => {}, sendEvent: () => {} } as never);

  try {
    await room.command(me, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    report.seated = true;
  } catch (err) {
    report.note = `cannot sit: ${(err as Error).message}`;
    room.dispose();
    return report;
  }

  // Give the table a moment to deal, if one player is enough to start it.
  for (let i = 0; i < 40 && room.snapshotFor(me).phase === 'WAITING'; i++) await wait(25);
  const afterSit: TableSnapshot = room.snapshotFor(me);
  report.dealt = afterSit.phase !== 'WAITING';

  const move = FIRST_MOVE[String(config.game)];
  report.game = String(config.game);
  if (move) {
    try {
      await room.command(me, move);
      report.moved = true;
    } catch (err) {
      report.note = `move refused: ${(err as Error).message}`;
    }
  } else {
    report.note = report.dealt ? '' : 'needs a second player before any cards come out';
  }

  // Turn-based games need the visitor to keep acting; betting games resolve on the last bet or on
  // a clock. Both are just "wait for the round to end, taking our turns when they come".
  for (let i = 0; i < 600 && room.snapshotFor(me).phase !== 'SHOWDOWN'; i++) {
    const taken = await takeTurnIfOurs(room, me, String(config.game));
    if (!taken) await wait(25);
  }
  const end = room.snapshotFor(me);
  report.settled = end.phase === 'SHOWDOWN' || bank.sinkTotal() > 0;
  if (!report.note && !report.settled) report.note = `stuck in ${end.phase}`;

  room.dispose();
  return report;
}

async function main(): Promise<void> {
  console.log('\n  Can one person play this table, alone, right now?\n');
  console.log('  table            sit   deal   move   round   note');
  console.log('  ' + '─'.repeat(88));

  const reports: Report[] = [];
  for (const config of defaultTables()) {
    const r = await probe(config as LiveTableConfig);
    reports.push(r);
    const tick = (ok: boolean): string => (ok ? ' ✓ ' : ' ✗ ');
    console.log(
      `  ${r.table.padEnd(16)}${tick(r.seated)}   ${tick(r.dealt)}  ${tick(r.moved || !FIRST_MOVE[r.game])}  ` +
        `${tick(r.settled)}   ${r.note}`,
    );
  }

  const playable = reports.filter((r) => r.settled).length;
  console.log(
    `\n  ${playable} of ${reports.length} tables can be played through by a single visitor.\n`,
  );
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

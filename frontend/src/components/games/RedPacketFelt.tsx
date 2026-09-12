import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LiveSeat, TableCommand, TableSnapshot } from '@/lib/liveTable';
import { CoinIcon, MineIcon, PacketIcon } from './redpacket/icons';
import { Envelope } from './redpacket/Envelope';
import { Avatar, SweeperColumn, type SweeperState } from './redpacket/SweeperColumn';

/**
 * RED PACKET MINESWEEPER (红包扫雷) — built to the reference screen.
 *
 * Top to bottom, the way the reference lays it out: the banker on the top rail
 * with 申请埋雷 beside them; 总金额 / 包数 / 雷号 across the middle; the
 * countdown under that; the envelope in the centre with 点我 on it; a 扫雷玩家
 * column down each side with everyone's take; and your own seat on the bottom
 * rail.
 *
 * THE GAME CHANGED UNDER THIS FILE. It used to draw a 5×5 grid of numbered
 * packets, because the room behind it was the grid version of 红包扫雷. The room
 * is now the GRAB version (`game-server/src/live/red-envelope-room.ts`): one
 * envelope, one packet each, and the mine is the LAST DIGIT of the amount you
 * got rather than a cell somebody stepped on.
 *
 * WHAT IS NOT THE REFERENCE, and deliberately:
 *
 *   AMOUNTS ARE WHOLE CHIPS. The reference shows 8.38, 0.40, 79.83 — its unit
 *   is a cent, so its mine digit is the last DECIMAL. Our live tables settle in
 *   whole table chips, and introducing a 100× unit in one game is the
 *   money-unit trap docs/TRAPS.md opens with. Identical layout; no decimal
 *   point.
 *
 *   NO SHOP AND NO LIKE/SHARE BAR. The cart in the reference's corner and the
 *   social row along its bottom belong to another app — there is no store
 *   behind them here, and a control that opens nothing is what this project
 *   keeps deleting. The player count IS drawn, because the server sends one.
 *
 * Every figure is the server's. This file lays out what the room sent and
 * computes no packet, total or net of its own.
 */

/** Mirrors the `gameState` built in game-server/src/live/red-envelope-room.ts. */
interface RedEnvelopeRound {
  totalAmount: number;
  packetCount: number;
  remaining: number;
  mineNumber: number;
  penaltyMultiplier: number;
  commit: string;
  /** Present only once the round has revealed. */
  packets?: number[];
  serverSeed?: string;
  seats: Array<{
    index: number;
    isBanker: boolean;
    wantsBank?: boolean;
    claimed?: number;
    mineHit?: boolean;
    net?: number;
  }>;
}

export interface RedPacketFeltProps {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}

export function RedPacketFelt({ snapshot, onCommand }: RedPacketFeltProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const round = snapshot?.gameState as RedEnvelopeRound | undefined;
  const you = seats.find((s) => s.isYou);

  const stateOf = (index: number): SweeperState | undefined =>
    round?.seats.find((s) => s.index === index);
  const isBanker = (s: LiveSeat): boolean =>
    Boolean(round?.seats.find((r) => r.index === s.index)?.isBanker);

  const banker = seats.find((s) => s.playerId && isBanker(s));
  const sweepers = seats.filter((s) => s.playerId && !isBanker(s));

  const yourState = you ? stateOf(you.index) : undefined;
  const yourClaim = yourState?.claimed;
  const youBank = Boolean(you && isBanker(you));
  const youApplied = Boolean(yourState?.wantsBank);

  const secondsLeft = snapshot?.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  /*
   * 恭喜抢到红包! — the ribbon across the envelope in the moment you grab.
   *
   * Driven off the snapshot rather than off the click: the claim is the
   * SERVER's to grant, and announcing it on the tap would congratulate someone
   * whose claim was about to be refused (a full envelope, a lost race, a
   * dropped socket). It appears when your claim appears and clears itself.
   *
   * `handNumber` is in the key so the next round's grab re-announces instead of
   * being swallowed as "same claim as before".
   */
  const [banner, setBanner] = useState<string | null>(null);
  const claimKey = yourClaim === undefined ? null : `${snapshot?.handNumber ?? 0}:${yourClaim}`;
  useEffect(() => {
    if (claimKey === null) {
      setBanner(null);
      return;
    }
    setBanner(yourState?.mineHit ? t('redPacket.hitMine') : t('redPacket.grabbed'));
    const timer = setTimeout(() => setBanner(null), 2_600);
    return () => clearTimeout(timer);
    // `yourState` is re-derived every render; the claim key is what identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimKey]);

  const canClaim =
    Boolean(you) &&
    phase === 'IN_HAND' &&
    !youBank &&
    yourClaim === undefined &&
    (round?.remaining ?? 0) > 0;

  const sit = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  const claim = (): void => {
    if (!canClaim) return;
    onCommand?.({ kind: 'act', action: { type: 'claim' } });
  };

  const applyBank = (): void => {
    if (!you || youBank) return;
    onCommand?.({ kind: 'act', action: { type: youApplied ? 'cancel-bank' : 'apply-bank' } });
  };

  // The reference fills the left column first, then the right.
  const half = Math.ceil(sweepers.length / 2);

  return (
    <div className="relative flex min-h-[36rem] w-full flex-col self-stretch overflow-hidden select-none">
      {/*
        THE TABLE'S OWN LIGHT. A soft plum glow in the upper middle and a copper
        rail curving across the bottom — the reference's room, painted over
        whatever ground colour the player has chosen rather than replacing it.
        Purely decorative and behind everything, hence `pointer-events-none`.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 18%, rgba(150,52,86,0.55) 0%, rgba(90,24,48,0.35) 45%, rgba(30,8,18,0.55) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-12%] bottom-[-9rem] z-0 h-[14rem] rounded-[50%] border-t-[6px] border-[#c8762f]/70"
        style={{
          background: 'radial-gradient(60% 60% at 50% 0%, rgba(200,118,47,0.28) 0%, transparent 70%)',
        }}
      />

      {/* ── THE BANKER, on the top rail ─────────────────────────────────────── */}
      <div className="relative z-10 flex items-start justify-center gap-2 px-2 pt-2">
        <div className="flex items-center gap-2 rounded-full border border-[#f0c760]/70 bg-[linear-gradient(180deg,rgba(120,30,44,0.95),rgba(70,16,28,0.95))] py-1 pr-3 pl-1 shadow-[0_4px_12px_rgba(0,0,0,0.45)]">
          <Avatar seat={banker} size={34} />
          <div className="min-w-0">
            <div className="truncate text-[0.7rem] leading-tight font-bold text-[#ffe6b0]">
              {banker?.name ?? t('redPacket.noBanker')}
            </div>
            {banker && (
              <div className="flex items-center gap-1">
                <CoinIcon size={13} />
                <span className="text-[0.74rem] leading-none font-black text-[#ffd97a] tabular-nums">
                  {banker.stack}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 申请埋雷 — the reference's blue pill. Shown only to someone seated who
            is not already banking: a control nobody present can use should not
            be on the screen. */}
        {you && !youBank && (
          <button
            type="button"
            onClick={applyBank}
            className={`rounded-full border px-3.5 py-1.5 text-[0.72rem] font-black whitespace-nowrap text-white shadow-[0_3px_10px_rgba(0,0,0,0.4)] transition active:scale-95 ${
              youApplied
                ? 'border-sky-200 bg-[linear-gradient(180deg,#7dd3fc,#0284c7)]'
                : 'border-sky-300/80 bg-[linear-gradient(180deg,#38bdf8,#1d4ed8)]'
            }`}
          >
            {youApplied ? t('redPacket.applied') : t('redPacket.applyBank')}
          </button>
        )}

        {/* The player count the reference puts top-right. Real: the server
            sends it. No cart beside it — there is no store to open. */}
        {snapshot?.spectators !== undefined && (
          <div className="absolute top-2 right-2 flex flex-col items-center rounded-lg border border-[#f0c760]/50 bg-black/35 px-2 py-1">
            <WatchersIcon />
            <span className="text-[0.6rem] leading-none font-black text-[#ffd97a] tabular-nums">
              ({snapshot.spectators})
            </span>
          </div>
        )}
      </div>

      {/* ── 总金额 / 包数 / 雷号 ─────────────────────────────────────────────── */}
      <div className="relative z-10 mt-3 flex items-center justify-center gap-2 px-2 sm:gap-4">
        <StatPill icon={<CoinIcon size={17} />} label={t('redPacket.total')} value={round?.totalAmount ?? '—'} />
        <StatPill icon={<PacketIcon size={17} />} label={t('redPacket.packets')} value={round?.remaining ?? '—'} />
        <StatPill icon={<MineIcon size={17} />} label={t('redPacket.mineNumber')} value={round?.mineNumber ?? '—'} />
      </div>

      {/* ── 倒计时 ──────────────────────────────────────────────────────────── */}
      <div className="relative z-10 mt-3 text-center text-[1.05rem] font-black tracking-wide text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]">
        {phase === 'IN_HAND' && secondsLeft !== null ? (
          <>
            {t('redPacket.countdown')} <span className="tabular-nums">（{secondsLeft}）</span>
          </>
        ) : phase === 'SHOWDOWN' ? (
          t('redPacket.revealed')
        ) : (
          <span className="text-white/70">{t('redPacket.waiting')}</span>
        )}
      </div>

      {/* A table that cannot start says why — the room's own sentence. */}
      {snapshot?.message && phase === 'WAITING' && (
        <div className="relative z-10 mt-1 text-center text-[0.72rem] text-rose-200/90">
          {snapshot.message}
        </div>
      )}

      {/* ── The columns, and the envelope between them ──────────────────────── */}
      <div className="relative z-10 flex flex-1 items-start justify-between gap-1 px-1.5 py-3">
        <SweeperColumn
          title={t('redPacket.sweepers')}
          players={sweepers.slice(0, half)}
          stateOf={stateOf}
          side="left"
          youLabel={t('redPacket.you')}
        />

        <div className="flex flex-1 flex-col items-center justify-start pt-4">
          <Envelope
            open={phase === 'SHOWDOWN' || yourClaim !== undefined}
            {...(yourClaim !== undefined ? { amount: yourClaim } : {})}
            {...(yourState?.mineHit !== undefined ? { mineHit: yourState.mineHit } : {})}
            canClaim={canClaim}
            onClaim={claim}
            label={t('redPacket.tapMe')}
            banner={banner}
          />

          {/* The rule, in the one place a player is deciding whether to tap. */}
          {round && (
            <div className="mt-3 max-w-[10rem] text-center text-[0.62rem] leading-tight text-white/70">
              {t('redPacket.mineRule', {
                digit: round.mineNumber,
                multiplier: round.penaltyMultiplier,
              })}
            </div>
          )}
        </div>

        <SweeperColumn
          title={t('redPacket.sweepers')}
          players={sweepers.slice(half)}
          stateOf={stateOf}
          side="right"
          youLabel={t('redPacket.you')}
        />
      </div>

      {/* ── Your own seat, on the bottom rail ───────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-center px-3 pb-3">
        {you ? (
          <div className="flex items-center gap-2 rounded-full border border-[#f0c760]/70 bg-[linear-gradient(180deg,rgba(150,32,44,0.95),rgba(90,16,26,0.95))] py-1 pr-5 pl-1 shadow-[0_4px_12px_rgba(0,0,0,0.45)]">
            <Avatar seat={you} size={34} />
            <div className="min-w-0">
              <div className="truncate text-[0.7rem] leading-tight font-bold text-[#ffe6b0]">
                {you.name}
              </div>
              <div className="flex items-center gap-1">
                <CoinIcon size={13} />
                <span className="text-[0.74rem] leading-none font-black text-[#ffd97a] tabular-nums">
                  {you.stack}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={sit}
            className="rounded-xl bg-[linear-gradient(180deg,#f7d68a,#c9902c)] px-8 py-2.5 text-sm font-black tracking-wider text-[#5a2a12] uppercase shadow-lg active:scale-95"
          >
            {t('redPacket.join')}
          </button>
        )}
      </div>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[0.78rem] font-bold whitespace-nowrap text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
        {label}
      </span>
      <span className="flex min-w-[3.6rem] items-center gap-1 rounded-full border border-black/30 bg-[#4a1220]/85 py-[3px] pr-3 pl-[3px] shadow-inner">
        {icon}
        <span className="text-[0.8rem] leading-none font-black text-white tabular-nums">
          {value}
        </span>
      </span>
    </div>
  );
}

function WatchersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="#ffd97a" strokeWidth="1.6" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="#ffd97a" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 6.2a3.2 3.2 0 0 1 0 6M17.5 19a5.5 5.5 0 0 0-2.2-4.4" stroke="#ffd97a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { errorKey } from '@/api/errors';
import { joinByPinApi, type PlayerTableGame } from '@/api/tables';
import { TableEntryModal } from '@/components/TableEntryModal';
import { haptic } from '@/lib/telegram';

/** Must match CODE_LENGTH in game-server/src/gateway/table-access.ts. */
const PIN_LENGTH = 6;

/** The Lobby opens Texas Hold'em tables only; every other game is created from Games. */
const LOBBY_GAMES: readonly PlayerTableGame[] = ['texas'];

/**
 * Tab 3 — Lobby: straight into Texas Hold'em.
 *
 * Owner's instruction, 15 Sep 2026: the Lobby tab goes straight to Hold'em,
 * shaped like HHPoker's centre tab — one field for a game PIN, a button to join
 * with it, and a button to start a game. Every other game stays in Games. The
 * feed that used to be this page (banners, CREATE / JOIN, All games,
 * Tournament) moved whole to the top of Alliance — components/lobby/HomeFeed.tsx.
 *
 * NOTHING HERE IS DECORATION. The PIN box calls `/tables/join`, which exists
 * for it: a PIN alone names a table, and a private table's PIN is its code, so
 * typing it also lets the player in. Create Game opens the same create screen
 * Games uses, already past the join-or-create question.
 */
export function Lobby() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputId = useId();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const ready = pin.length === PIN_LENGTH && !joining;

  const join = async (): Promise<void> => {
    if (!ready) return;
    haptic('light');
    setJoining(true);
    setError(null);
    try {
      const { tableId } = await joinByPinApi(pin);
      navigate(`/table/${tableId}`);
    } catch (e) {
      // A PIN that matches nothing and a player out of guesses are the two
      // answers someone can act on, so they get words of their own.
      if (e instanceof ApiError && e.status === 404) setError(t('lobby.pinNotFound'));
      else if (e instanceof ApiError && e.status === 429) setError(t('lobby.pinTooMany'));
      else setError(t(errorKey(e)));
    } finally {
      setJoining(false);
    }
  };

  return (
    <>
      {/* The ground is portalled to <body>. The page renders inside a motion
          wrapper whose transform turns `fixed` into "fixed to the wrapper",
          which would leave the edges of the screen bare. */}
      {createPortal(
        <div aria-hidden className="lobby-ground pointer-events-none fixed inset-0 -z-10" />,
        document.body,
      )}

      <div className="flex min-h-[calc(100dvh-11rem)] flex-col items-center justify-center pb-6 text-center">
        <label htmlFor={inputId} className="text-[0.95rem] text-[#c7d2e4]">
          {t('lobby.pinPrompt')}
        </label>
        <input
          id={inputId}
          value={pin}
          onChange={(e) => {
            // Digits only, and never more than a PIN holds — a pasted
            // "694 023" or "PIN: 694023" still lands as the six digits.
            setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void join();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          enterKeyHint="go"
          maxLength={PIN_LENGTH + 8}
          aria-invalid={error !== null}
          // The letter-spacing trails the last digit too; the matching left
          // padding keeps the six digits centred in the field.
          className="lobby-pin mt-3 h-12 w-full max-w-[15.5rem] rounded-md pl-[0.45em] text-center font-mono text-2xl tracking-[0.45em] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        />
        <p role="alert" className="mt-2 min-h-5 text-[0.8rem] text-danger">
          {error}
        </p>

        <button
          type="button"
          disabled={!ready}
          onClick={() => void join()}
          className="mt-2 h-13 w-full max-w-[16.5rem] rounded-full bg-gold text-lg font-semibold text-[#3a2a14] shadow-[0_2px_0_rgb(0_0_0/0.3)] transition active:scale-[0.98] disabled:opacity-60"
        >
          {joining ? t('lobby.joining') : t('lobby.joinGame')}
        </button>

        <p className="mt-20 text-[0.95rem] text-[#c7d2e4]">{t('lobby.startAndInvite')}</p>
        <TableButton
          label={t('lobby.createGame')}
          onClick={() => {
            haptic('light');
            setCreateOpen(true);
          }}
        />
      </div>

      <TableEntryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        startWith="create"
        games={LOBBY_GAMES}
      />
    </>
  );
}

/** The table's outline: HHPoker's rounded table with the dip at its top edge. */
const TABLE_SHAPE =
  'M62 8C92 8 102 20 120 20S148 8 178 8C214 8 236 30 236 57S214 106 178 106H62C26 106 4 84 4 57S26 8 62 8Z';

/**
 * Create Game, drawn as a poker table — a copper rail around an indigo felt.
 *
 * Inline SVG rather than artwork: it scales to any width without a second
 * asset, stays sharp, and costs nothing on the one screen every player opens.
 */
function TableButton({ label, onClick }: { label: string; onClick: () => void }) {
  // useId can contain characters that are not valid inside url(#…).
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inset = (sx: number, sy: number): string =>
    `translate(120 57) scale(${sx} ${sy}) translate(-120 -57)`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative mt-4 grid w-full max-w-[16.5rem] place-items-center transition active:scale-[0.97]"
      style={{ aspectRatio: '240 / 114' }}
    >
      <svg
        viewBox="0 0 240 114"
        aria-hidden
        className="absolute inset-0 size-full drop-shadow-[0_6px_10px_rgb(0_0_0/0.45)]"
      >
        <defs>
          <linearGradient id={`${id}-rail`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ec9f5a" />
            <stop offset="0.5" stopColor="#a9571f" />
            <stop offset="1" stopColor="#6a3210" />
          </linearGradient>
          <radialGradient id={`${id}-felt`} cx="0.5" cy="0.42" r="0.7">
            <stop offset="0" stopColor="#12598d" />
            <stop offset="1" stopColor="#062a4d" />
          </radialGradient>
        </defs>
        <path d={TABLE_SHAPE} fill={`url(#${id}-rail)`} stroke="#2b1405" strokeWidth="2" />
        <path d={TABLE_SHAPE} fill={`url(#${id}-felt)`} transform={inset(0.9, 0.82)} />
        <path
          d={TABLE_SHAPE}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.14"
          strokeWidth="1.5"
          transform={inset(0.82, 0.7)}
        />
      </svg>
      <span className="relative text-xl font-medium text-white">{label}</span>
    </button>
  );
}

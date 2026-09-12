import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, X } from 'lucide-react';
import { PICKABLE_DESIGNS, groundFor } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';
import { useSettings, useUpdateSettings } from '@/api/hooks';
import { useTablePrefs, RAISE_PRESETS } from '@/store/tablePrefs';
import { cn } from '@/lib/cn';

/**
 * Personal settings, after the reference app's panel.
 *
 * WHERE EACH SWITCH ACTUALLY LIVES — this is the whole design decision here,
 * because a settings panel whose switches do nothing is worse than no panel.
 *
 *  - Table colour  → the existing design store (account-persisted already)
 *  - Game sound    → the ACCOUNT's `sound` field, the same one Settings writes,
 *                    so muting here mutes everywhere and survives a reinstall
 *  - everything else → `useTablePrefs`, persisted locally
 *
 * The local ones are local HONESTLY, not as a placeholder: four-colour decks,
 * a default raise size, bet-slider confirmation and hiding the insurance
 * prompt are all preferences about how this device draws the table. None of
 * them changes what the server does, none affects another player, and none is
 * worth a round trip mid-hand. If they later need to follow a player across
 * devices, they move to `/me/settings` — the shape here does not change.
 *
 * HOST OPTIONS IS NOT A TAB HERE. The reference has one; ours would need to
 * know which table controls the server lets an owner change mid-game, and that
 * has not been established. Drawing a tab of switches that silently do nothing
 * to a live table — with other people's money on it — is the exact failure this
 * file's layout is designed to avoid. It arrives when the server contract does.
 */
export function TableSettingsSheet({
  open,
  onClose,
  tableId,
  isOwner = false,
  seats = [],
  canStart = false,
  paused = false,
  closing = false,
  onStart,
  onKick,
  onPause,
  onCloseTable,
}: {
  open: boolean;
  onClose: () => void;
  /** Scopes the per-table preferences. */
  tableId: string;
  /** Whether this player created the table. Gates the Host Options tab. */
  isOwner?: boolean;
  /** Seated players, for the host's remove list. */
  seats?: { playerId: string; name: string; isYou: boolean }[];
  /** The manual-start button is live only before the first hand. */
  canStart?: boolean;
  /** Owner has stopped new hands. */
  paused?: boolean;
  /** A close is already queued. */
  closing?: boolean;
  onStart?: () => void;
  onKick?: (playerId: string) => void;
  onPause?: (next: boolean) => void;
  onCloseTable?: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'personal' | 'host'>('personal');
  const design = useTableDesign((s) => s.design);
  const setDesign = useTableDesign((s) => s.setDesign);

  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const prefs = useTablePrefs();
  const [customOpen, setCustomOpen] = useState(false);

  const hideInsurance = prefs.hideInsuranceFor.includes(tableId);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            role="dialog"
            aria-label={t('table.personalSettings')}
            className="fixed inset-x-3 top-1/2 z-[61] max-h-[88vh] -translate-y-1/2 overflow-y-auto rounded-(--radius-app) border border-border bg-surface p-4 shadow-2xl sm:mx-auto sm:max-w-sm"
          >
            {/* Two tabs, as the reference has. Host Options is shown ONLY to
                the table's owner — to everyone else it is not a greyed tab but
                no tab at all, because "you are not the host" is not a state a
                player needs a disabled control to learn. */}
            <div className="mb-4 flex items-center gap-4">
              <TabButton active={tab === 'personal'} onClick={() => setTab('personal')}>
                {t('table.personalSettings')}
              </TabButton>
              {isOwner && (
                <TabButton active={tab === 'host'} onClick={() => setTab('host')}>
                  {t('table.hostOptions')}
                </TabButton>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="ml-auto grid size-8 shrink-0 place-items-center rounded-full text-dim active:scale-95"
              >
                <X size={17} />
              </button>
            </div>

            {tab === 'host' && isOwner && (
              <HostOptions
                seats={seats}
                canStart={canStart}
                paused={paused}
                closing={closing}
                onPause={(next) => onPause?.(next)}
                onCloseTable={() => onCloseTable?.()}
                onStart={() => {
                  onStart?.();
                  onClose();
                }}
                onKick={(id) => onKick?.(id)}
              />
            )}


            {tab === 'personal' && (
              <>
            {/* ── Table colour ─────────────────────────────────────────── */}
            <Label>{t('table.tableColour')}</Label>
            <div className="mb-4 flex gap-2">
              {PICKABLE_DESIGNS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDesign(d.id)}
                  aria-label={d.name}
                  aria-pressed={d.id === design.id}
                  className={cn(
                    'relative h-14 flex-1 rounded-lg border-2 transition-colors',
                    d.id === design.id ? 'border-brand' : 'border-border',
                  )}
                  style={{ background: groundFor(d) }}
                >
                  {d.id === design.id && (
                    <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-brand text-bg">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Deck style ───────────────────────────────────────────── */}
            <Label>{t('table.deckStyle')}</Label>
            <div className="mb-4 flex gap-2">
              {([true, false] as const).map((four) => (
                <button
                  key={String(four)}
                  type="button"
                  onClick={() => prefs.setFourColour(four)}
                  aria-pressed={prefs.fourColour === four}
                  // NO BOX. The cards sit bare on the panel; only the chosen
                  // option is ringed. A filled, bordered square around each
                  // pair made two heavy containers compete with the cards that
                  // are the actual choice.
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-lg border-2 py-2.5 transition-colors',
                    prefs.fourColour === four ? 'border-brand' : 'border-transparent',
                  )}
                >
                  {/* Four miniature cards, in the suit colours that option
                      produces — the choice IS the colours, so it is shown
                      rather than described. */}
                  {(
                    [
                      ['J', '♦', four ? '#3b82f6' : '#e5484d'],
                      ['Q', '♣', four ? '#22c55e' : '#111111'],
                      ['K', '♥', '#e5484d'],
                      ['A', '♠', '#111111'],
                    ] as const
                  ).map(([rank, suit, colour]) => (
                    <span
                      key={suit}
                      className="grid h-7 w-5 place-items-center rounded-[3px] bg-white text-[0.5rem] font-black leading-none"
                      style={{ color: colour }}
                    >
                      <span>{rank}</span>
                      <span>{suit}</span>
                    </span>
                  ))}
                </button>
              ))}
            </div>

            {/* ── Default raise ────────────────────────────────────────── */}
            <Label>{t('table.defaultRaise')}</Label>
            {/* CIRCLES, and a `+` at BOTH ends, as the reference has it. These
                were wide pills with a single trailing `+`; the row reads as a
                set of equal choices, and a stretched pill next to a round
                button does not. Fixed-size so they stay circular whatever the
                panel width — `flex-1` is what made them ovals. */}
            <div className="mb-3 flex items-center justify-center gap-2.5">
              <RaiseCircle
                onClick={() => setCustomOpen((v) => !v)}
                label={t('table.customRaise')}
                expanded={customOpen}
              >
                <Plus size={15} />
              </RaiseCircle>

              {RAISE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => prefs.setDefaultRaise(preset.id)}
                  aria-pressed={prefs.defaultRaise === preset.id}
                  className={cn(
                    'grid size-11 shrink-0 place-items-center rounded-full border text-[0.72rem] font-bold transition-colors',
                    prefs.defaultRaise === preset.id
                      ? 'border-brand bg-brand/15 text-brand'
                      : 'border-border bg-surface-2 text-dim',
                  )}
                >
                  {preset.label}
                </button>
              ))}

              <RaiseCircle
                onClick={() => setCustomOpen((v) => !v)}
                label={t('table.customRaise')}
                expanded={customOpen}
              >
                <Plus size={15} />
              </RaiseCircle>
            </div>

            <div className="mb-4 rounded-(--radius-app) bg-surface-2 p-3 text-center">
              {customOpen ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[0.66rem] text-dim">{t('table.customRaiseBlurb')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    step={0.1}
                    value={prefs.customRaise ?? ''}
                    placeholder="2.5"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      // Rejected rather than stored as 0: a default raise of
                      // zero is not a bet, and NaN would silently disable the
                      // preset the next time it was read.
                      prefs.setCustomRaise(Number.isFinite(n) && n > 0 ? n : null);
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm text-text focus:border-brand focus:outline-none"
                  />
                  <span className="text-[0.6rem] text-dim">{t('table.customRaiseUnit')}</span>
                </label>
              ) : (
                <>
                  <p className="text-[0.74rem] font-semibold text-text">
                    {t('table.setDefaultRaise')}
                  </p>
                  <p className="mt-0.5 text-[0.66rem] leading-snug text-dim">
                    {t('table.customRaiseBlurb')}
                  </p>
                </>
              )}
            </div>

            {/* ── Switches ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <Switch
                label={t('table.gameSound')}
                // The ACCOUNT's setting. Rendered off while it loads rather
                // than guessing — a mute switch showing a guess is the bug
                // this rule exists for.
                value={settings.isSuccess ? settings.data.sound : false}
                disabled={!settings.isSuccess || updateSettings.isPending}
                onChange={(v) => updateSettings.mutate({ sound: v })}
              />
              <Switch
                label={t('table.chattingSound')}
                value={prefs.chatSound}
                onChange={prefs.setChatSound}
              />
              <Switch
                label={t('table.hideInsurance')}
                hint={t('table.thisTableOnly')}
                value={hideInsurance}
                onChange={(v) => prefs.setHideInsurance(tableId, v)}
              />
              <Switch
                label={t('table.sliderConfirm')}
                value={prefs.confirmBets}
                onChange={prefs.setConfirmBets}
              />
            </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * The `+` at either end of the raise row.
 *
 * Both open the same custom-amount field — the reference puts one on each side
 * and they are the same control, not two different ones. Shared rather than
 * written twice so they cannot drift apart.
 */
function RaiseCircle({
  onClick,
  label,
  expanded,
  children,
}: {
  onClick: () => void;
  label: string;
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-dim transition-colors active:scale-95"
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'text-sm font-bold transition-colors',
        active ? 'text-text' : 'text-dim hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

/**
 * What a host can actually do — and it is short, deliberately.
 *
 * The server gates exactly two things on `ownerId`: starting a manual table,
 * and removing a player. There is no pause, no mid-game settings change and no
 * close-table command, so there are no controls for them here. The reference
 * app's tab has more; ours shows what exists rather than switches that would
 * do nothing to a live table with other people's money on it.
 */
function HostOptions({
  seats,
  canStart,
  paused,
  closing,
  onStart,
  onKick,
  onPause,
  onCloseTable,
}: {
  seats: { playerId: string; name: string; isYou: boolean }[];
  canStart: boolean;
  paused: boolean;
  closing: boolean;
  onStart: () => void;
  onKick: (playerId: string) => void;
  onPause: (next: boolean) => void;
  onCloseTable: () => void;
}) {
  const { t } = useTranslation();
  const others = seats.filter((s) => !s.isYou);

  return (
    <div className="flex flex-col gap-4">
      {/* Start is only meaningful before the first hand; after that the server
          treats it as a no-op, so the button goes rather than lying. */}
      {canStart && (
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-(--radius-app) bg-gold py-2.5 text-sm font-bold text-bg active:scale-[0.98]"
        >
          {t('table.startGame')}
        </button>
      )}

      {/* Pause. The label says what it actually does — "no new hands" rather
          than "pause", which would suggest the hand on the table freezes. */}
      <Switch
        label={paused ? t('table.resumeDealing') : t('table.pauseDealing')}
        hint={t('table.pauseHint')}
        value={paused}
        onChange={onPause}
      />

      <div>
        <Label>{t('table.removePlayer')}</Label>
        {others.length === 0 ? (
          <p className="py-3 text-center text-[0.7rem] text-dim">{t('table.noOtherPlayers')}</p>
        ) : (
          <ul className="flex flex-col">
            {others.map((seat) => (
              <li
                key={seat.playerId}
                className="flex items-center justify-between gap-3 border-b border-border/50 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[0.76rem] text-text">{seat.name}</span>
                <button
                  type="button"
                  onClick={() => onKick(seat.playerId)}
                  className="shrink-0 rounded-full border border-danger/50 px-3 py-1 text-[0.66rem] font-bold text-danger active:scale-95"
                >
                  {t('table.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Says what a removal does, because the alternative is a player
            guessing whether it costs them their chips. */}
        <p className="mt-2 text-[0.62rem] leading-snug text-dim">{t('table.removeBlurb')}</p>
      </div>

      {/* Close, last and in danger red — it ends the table for everyone.
          Once requested it cannot be taken back, so the button reports the
          queued state rather than offering itself again. */}
      <div className="border-t border-border/60 pt-3">
        {closing ? (
          <p className="text-center text-[0.7rem] font-semibold text-warn">
            {t('table.closingBlurb')}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={onCloseTable}
              className="w-full rounded-(--radius-app) border border-danger/60 py-2.5 text-sm font-bold text-danger active:scale-[0.98]"
            >
              {t('table.closeTable')}
            </button>
            <p className="mt-2 text-[0.62rem] leading-snug text-dim">{t('table.closeBlurb')}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[0.66rem] text-dim">{children}</div>;
}

function Switch({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="min-w-0">
        <span className="block truncate text-[0.72rem] text-text">{label}</span>
        {hint ? <span className="block text-[0.55rem] text-dim">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          value ? 'bg-brand' : 'bg-surface-2 border border-border',
          disabled && 'opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white transition-all',
            value ? 'left-[1.4rem]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

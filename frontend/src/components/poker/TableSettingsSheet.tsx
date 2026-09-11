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
}: {
  open: boolean;
  onClose: () => void;
  /** Scopes the per-table preferences. */
  tableId: string;
}) {
  const { t } = useTranslation();
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
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-text">{t('table.personalSettings')}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="grid size-8 shrink-0 place-items-center rounded-full text-dim active:scale-95"
              >
                <X size={17} />
              </button>
            </div>

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
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-lg border-2 bg-surface-2 py-2.5 transition-colors',
                    prefs.fourColour === four ? 'border-brand' : 'border-border',
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
            <div className="mb-3 flex items-center gap-2">
              {RAISE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => prefs.setDefaultRaise(preset.id)}
                  aria-pressed={prefs.defaultRaise === preset.id}
                  className={cn(
                    'h-10 flex-1 rounded-full border text-[0.72rem] font-bold transition-colors',
                    prefs.defaultRaise === preset.id
                      ? 'border-brand bg-brand/15 text-brand'
                      : 'border-border bg-surface-2 text-dim',
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                aria-label={t('table.customRaise')}
                aria-expanded={customOpen}
                className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-dim active:scale-95"
              >
                <Plus size={15} />
              </button>
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
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

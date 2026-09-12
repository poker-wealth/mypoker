import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gem } from 'lucide-react';
import { FullScreenModal } from '@/components/ui/FullScreenModal';
import { Segmented } from '@/components/ui/Segmented';
import { chips, moneyFromDecimal } from '@/lib/money';
import { cn } from '@/lib/cn';
import { visibleGames } from '@/lib/games';
import { seatCapFor } from '@/lib/tableDesigns';
import { useBalance, useCreatePlayerTable } from '@/api/hooks';
import { logError } from '@/api/errors';
import { toast } from '@/lib/toast';
import type { CreatedTable, PlayerTableGame, TableVisibility } from '@/api/tables';
import { ChipSlider, ChipRangeSlider, type SliderStop } from './ChipSlider';
import { ToggleRow } from './ChipToggle';
import { PokerChip } from './PokerChip';

/**
 * "Create a game" — the reference app's table-settings page, control for
 * control: gold stake figures up top, chip-thumb sliders, chip-knob toggles,
 * and the Balance/Cost bar with the gold "Start now" button.
 *
 * Every LIVE control here maps to a server field the room actually enforces
 * (see PokerRoomConfig in game-server). The reference rows whose backing
 * feature has not shipped yet — iOS-only, buy-in approval, cash-out chips,
 * game length, min holding, VPIP, service fee — render in place but disabled
 * with a "soon" mark: the layout matches the reference without a switch that
 * silently does nothing (frontend honesty rules).
 */

/** Blind pairs offered, in chips (1 chip = $0.01), smallest to biggest. */
const STAKES: { sb: number; bb: number }[] = [
  { sb: 1, bb: 2 },
  { sb: 2, bb: 4 },
  { sb: 5, bb: 10 },
  { sb: 10, bb: 20 },
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 250, bb: 500 },
];

/**
 * Buy-in range stops, in big blinds, labelled in the reference's ×100BB unit.
 * The server caps the MINIMUM at 500bb; stops beyond that exist for the max
 * thumb only, and `clampLow` keeps the low thumb off them.
 */
const BUY_IN_STOPS_BB = [50, 100, 150, 200, 250, 300, 400, 600, 800];
const MAX_MIN_BUY_IN_BB = 400;

/** Auto-start choices, as in the reference. 0 is "None": the creator starts the game by hand. */
const AUTO_START = [2, 3, 5, 7, 9];

const label100bb = (bb: number): string => {
  const x = bb / 100;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

export function CreateGameScreen({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (table: CreatedTable) => void;
}) {
  const { t } = useTranslation();
  const create = useCreatePlayerTable();
  const balance = useBalance();

  const [game, setGame] = useState<PlayerTableGame>('texas');
  const [visibility, setVisibility] = useState<TableVisibility>('public');
  const [stakeIx, setStakeIx] = useState(0);
  const [seats, setSeats] = useState(9);
  const [autoStart, setAutoStart] = useState(2);
  const [ante, setAnte] = useState(0);
  const [buyInLowBB, setBuyInLowBB] = useState(100);
  const [buyInHighBB, setBuyInHighBB] = useState(400);

  const [restrictOnlookers, setRestrictOnlookers] = useState(false);
  const [straddle, setStraddle] = useState(false);
  const [insurance, setInsurance] = useState(true);
  const [banSameGps, setBanSameGps] = useState(false);
  const [banSameIp, setBanSameIp] = useState(false);
  const [allInOrFold, setAllInOrFold] = useState(false);
  const [hideHoleCards, setHideHoleCards] = useState(false);

  const { sb, bb } = STAKES[stakeIx]!;
  // Poker gets the full options screen; every other game opens as a copy of
  // its house table, so the poker controls would be settings nothing reads.
  const isPoker = game === 'texas' || game === 'short-deck' || game === 'omaha';
  const seatCap = isPoker ? seatCapFor(game) : 2;
  const seatsClamped = Math.min(seats, seatCap);

  const stakeStops: SliderStop[] = STAKES.map((s, i) => ({ value: i, label: `${s.sb}/${s.bb}` }));
  const seatStops: SliderStop[] = Array.from({ length: seatCap - 1 }, (_, i) => ({
    value: i + 2,
    label: String(i + 2),
  }));
  const autoStartStops: SliderStop[] = [
    { value: 0, label: t('createGame.none') },
    ...AUTO_START.filter((n) => n <= seatsClamped).map((n) => ({ value: n, label: String(n) })),
  ];
  // Ante offered as fractions of the big blind, shown in chips — the only way
  // the row means the same thing at 1/2 and at 250/500.
  const anteStops: SliderStop[] = useMemo(() => {
    const values = [...new Set([0, Math.ceil(bb / 4), Math.ceil(bb / 2), bb, bb * 2])];
    return values.map((v) => ({ value: v, label: String(v) }));
  }, [bb]);
  const buyInStops: SliderStop[] = BUY_IN_STOPS_BB.map((v) => ({ value: v, label: label100bb(v) }));

  // Omaha is pot-limit; the server refuses AoF there and so does the screen.
  const aofAllowed = game !== 'omaha';

  const submit = (): void => {
    if (!isPoker) {
      // A house game: the server clones its standing table; the poker fields
      // would be ignored anyway, so they are not sent.
      create.mutate(
        { game, visibility },
        {
          onSuccess: onCreated,
          onError: (e) => {
            logError('createPlayerTable', e);
            toast.error(t('tableEntry.error'));
          },
        },
      );
      return;
    }
    create.mutate(
      {
        game,
        visibility,
        seats: seatsClamped,
        smallBlind: sb,
        bigBlind: bb,
        buyInBB: buyInLowBB,
        buyInMaxBB: buyInHighBB,
        ante,
        straddle,
        allInOrFold: aofAllowed && allInOrFold,
        hideHoleCards,
        spectatorsAllowed: !restrictOnlookers,
        insuranceEnabled: insurance,
        banSameIp,
        banSameGps,
        autoStartPlayers: Math.min(autoStart, seatsClamped),
      },
      {
        onSuccess: onCreated,
        onError: (e) => {
          logError('createPlayerTable', e);
          toast.error(t('tableEntry.error'));
        },
      },
    );
  };

  return (
    <FullScreenModal open={open} onClose={onClose} title={t('createGame.title')}>
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Every game on the platform, and who may find the table. Ours, not
              the reference's — one create screen serves the whole catalog. */}
          <div className="flex flex-wrap gap-1.5">
            {visibleGames().map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  const id = g.id as PlayerTableGame;
                  setGame(id);
                  if (id === 'texas' || id === 'short-deck' || id === 'omaha') {
                    setSeats((n) => Math.min(n, seatCapFor(id)));
                  }
                }}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold transition',
                  game === g.id
                    ? 'border-transparent bg-brand text-white'
                    : 'border-border bg-surface text-dim active:bg-surface-2',
                )}
              >
                {t(`gameNames.${g.id}`)}
              </button>
            ))}
          </div>
          <Segmented
            options={(['public', 'private'] as TableVisibility[]).map((v) => ({
              value: v,
              label: t(`tableEntry.${v}`),
            }))}
            value={visibility}
            onChange={setVisibility}
          />

          {!isPoker && (
            <p className="rounded-(--radius-app) border border-border bg-surface p-3 text-[0.72rem] leading-relaxed text-dim">
              {t('createGame.houseTableBlurb', { game: t(`gameNames.${game}`) })}
            </p>
          )}

          {/* Poker options — everything the reference screen offers. Hidden
              for house games, whose rooms read none of them. */}
          {isPoker && (
            <>
          {/* The reference's header: stakes and minimum buy-in, in gold. */}
          <div className="flex items-start justify-between pt-1">
            <div>
              <div className="text-3xl font-black tabular-nums text-gold">
                {sb}/{bb}
              </div>
              <div className="mt-0.5 text-[0.68rem] text-dim">{t('createGame.blinds')}</div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5 text-3xl font-black tabular-nums text-gold">
                <PokerChip size={20} className="opacity-90" />
                {(bb * buyInLowBB).toLocaleString()}
              </div>
              <div className="mt-0.5 text-[0.68rem] text-dim">{t('createGame.buyIn')}</div>
            </div>
          </div>
          <ChipSlider
            stops={stakeStops}
            value={stakeIx}
            onChange={setStakeIx}
            ariaLabel={t('createGame.blinds')}
          />

          <Section label={t('createGame.players')}>
            <ChipSlider
              stops={seatStops}
              value={seatsClamped}
              onChange={setSeats}
              ariaLabel={t('createGame.players')}
            />
          </Section>

          <Section label={t('createGame.autoStart')}>
            <ChipSlider
              stops={autoStartStops}
              value={Math.min(autoStart, seatsClamped)}
              onChange={setAutoStart}
              ariaLabel={t('createGame.autoStart')}
            />
          </Section>

          <Section label={t('createGame.ante')}>
            <ChipSlider
              stops={anteStops}
              value={anteStops.some((s) => s.value === ante) ? ante : 0}
              onChange={setAnte}
              ariaLabel={t('createGame.ante')}
            />
          </Section>

          <Section label={t('createGame.gameLength')} soonLabel={t('createGame.soon')}>
            <ChipSlider
              stops={['1', '1.5', '2', '2.5', '3', '4', '5', '6'].map((l, i) => ({
                value: i,
                label: l,
              }))}
              value={0}
              onChange={() => {}}
              disabled
              ariaLabel={t('createGame.gameLength')}
            />
          </Section>

          <Section label={t('createGame.buyInRange')}>
            <ChipRangeSlider
              stops={buyInStops}
              low={buyInLowBB}
              high={buyInHighBB}
              onChange={(lo, hi) => {
                // The server caps the MINIMUM buy-in at 500bb; the top stops
                // belong to the max thumb alone.
                setBuyInLowBB(Math.min(lo, MAX_MIN_BUY_IN_BB));
                setBuyInHighBB(hi);
              }}
              ariaLabelLow={t('createGame.buyInMin')}
              ariaLabelHigh={t('createGame.buyInMax')}
            />
            <p className="mt-1 text-[0.62rem] text-dim">
              {t('createGame.buyInBlurb', {
                min: chips(bb * buyInLowBB),
                max: chips(bb * buyInHighBB),
              })}
            </p>
          </Section>

          <Section label={t('createGame.minHolding')} soonLabel={t('createGame.soon')}>
            <ChipSlider
              stops={['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4'].map((l, i) => ({
                value: i,
                label: l,
              }))}
              value={0}
              onChange={() => {}}
              disabled
              ariaLabel={t('createGame.minHolding')}
            />
          </Section>

          <Section label={t('createGame.vpip')} soonLabel={t('createGame.soon')}>
            <ChipSlider
              stops={['0', '25', '30', '35', '40', '45'].map((l, i) => ({ value: i, label: l }))}
              value={0}
              onChange={() => {}}
              disabled
              ariaLabel={t('createGame.vpip')}
            />
          </Section>

          <Section label={t('createGame.serviceFee')} soonLabel={t('createGame.soon')}>
            <ChipSlider
              stops={['0', '0.5', '1', '1.5', '2', '2.5', '3', '5'].map((l, i) => ({
                value: i,
                label: l,
              }))}
              value={0}
              onChange={() => {}}
              disabled
              ariaLabel={t('createGame.serviceFee')}
            />
          </Section>

          {/* The toggle list, in the reference's order. */}
          <div className="divide-y divide-border/60 border-t border-border/60">
            <ToggleRow
              label={t('createGame.restrictOnlookers')}
              hint={t('createGame.restrictOnlookersHint')}
              checked={restrictOnlookers}
              onChange={setRestrictOnlookers}
            />
            <ToggleRow
              label={t('createGame.iosOnly')}
              checked={false}
              onChange={() => {}}
              soonLabel={t('createGame.soon')}
            />
            <ToggleRow
              label={t('createGame.straddle')}
              checked={straddle}
              onChange={setStraddle}
            />
            <ToggleRow
              label={t('createGame.buyInConfirm')}
              checked={false}
              onChange={() => {}}
              soonLabel={t('createGame.soon')}
            />
            <ToggleRow
              label={t('createGame.insurance')}
              hint={t('createGame.insuranceHint')}
              checked={insurance}
              onChange={setInsurance}
            />
            <ToggleRow
              label={t('createGame.banSameGps')}
              checked={banSameGps}
              onChange={setBanSameGps}
            />
            <ToggleRow
              label={t('createGame.banSameIp')}
              checked={banSameIp}
              onChange={setBanSameIp}
            />
            {aofAllowed && (
              <ToggleRow
                label={t('createGame.allInOrFold')}
                checked={allInOrFold}
                onChange={setAllInOrFold}
              />
            )}
            <ToggleRow
              label={t('createGame.hideHoleCards')}
              caption={t('createGame.hideHoleCardsCaption')}
              checked={hideHoleCards}
              onChange={setHideHoleCards}
            />
            <ToggleRow
              label={t('createGame.cashOutChips')}
              checked={false}
              onChange={() => {}}
              soonLabel={t('createGame.soon')}
            />
          </div>
            </>
          )}
        </div>

        {/* The reference's footer: balance, cost, Start now. Creating a table
            costs nothing today; the row says 0 because 0 is the truth. */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-4 py-2.5">
          <div className="min-w-0 flex-1 text-[0.68rem] leading-snug text-dim">
            <div className="flex items-center gap-1">
              {t('createGame.balance')}
              <Gem size={11} className="text-accent" />
              {/* THROUGH THE FORMATTER. Interpolated raw, this printed
                  "$61.040000" — the ledger's six-decimal string, straight onto
                  the screen. Every other balance in the app goes through
                  `moneyFromDecimal` (Profile, Wallet); this one did not. */}
              <span className="tabular-nums text-text">
                {balance.data ? `$${moneyFromDecimal(balance.data.available, { decimals: 2 })}` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {t('createGame.cost')}
              <Gem size={11} className="text-accent" />
              <span className="tabular-nums text-text">0</span>
            </div>
          </div>
          <button
            type="button"
            disabled={create.isPending}
            onClick={submit}
            className="rounded-(--radius-app) bg-gold px-8 py-2.5 text-sm font-bold text-bg transition active:scale-[0.98] disabled:opacity-60"
          >
            {create.isPending ? t('common.loading') : t('createGame.startNow')}
          </button>
        </div>
      </div>
    </FullScreenModal>
  );
}

function Section({
  label,
  soonLabel,
  children,
}: {
  label: string;
  soonLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[0.72rem] font-medium text-dim">
        {label}
        {soonLabel && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6rem] font-semibold text-dim">
            {soonLabel}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

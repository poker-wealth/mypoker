import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Settings2 } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useConfirmSheet } from '@/components/ui/ConfirmSheet';
import { useLeague, useCreateLeagueTable } from '@/api/hooks';
import { errorKey, leagueTableErrorKey, logError } from '@/api/errors';
import { useContextStore } from '@/store/context';
import { toast } from '@/lib/toast';
import type { League, LeagueDetail, LeagueTable, LeagueTableVariant } from '@/api/leagues';

/**
 * Open a league private room (v5.9 2 - SAMUEL_V2 task 3).
 *
 * WHY THIS LIVES IN THE ALLIANCE AND NOT THE LOBBY.
 * A private table belongs to a league: "league tables visible only to league
 * members, completely invisible to lobby players". A lobby player cannot open
 * one at all, so a creator in the lobby would be a control that only a handful
 * of viewers could ever use. The lobby button leads here instead.
 *
 * WHY THERE IS NO CLIENT-SIDE ADMIN GATE.
 * The endpoint allows OWNER and ADMIN. The browser can see who the OWNER is
 * (`league.ownerId`) but has no way to learn about ADMIN: `/me/leagues` and
 * `GET /leagues/:id` both return the league, not the caller's membership, and
 * the only role lookup is an internal service route behind a shared secret.
 * Gating on owner-only would hide this from every admin - a guard that lies -
 * so the sheet is offered to members of the league, states plainly who may use
 * it, and lets the SERVER answer. A 403 comes back as "only the alliance owner
 * or an admin can open a table", which is the truth and is actionable.
 *
 * What IS checked before the attempt is the league's settings, because that
 * refusal is not about the player: a league with no rake and buy-in gets an
 * explanation and no form, rather than a 400 after they have filled one in.
 */

const VARIANTS: LeagueTableVariant[] = ['texas', 'short-deck', 'omaha'];
const MAX_NAME = 40;

/** Strict: "6abc" and "" are not seat counts, and Number('') === 0 would say they are. */
const int = (raw: string): number => (/^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : NaN);

/** 250 -> "2.5". Trailing zeros dropped so a flat 5% does not read as "5.00%". */
const pct = (bps: number): string => (bps / 100).toFixed(2).replace(/\.?0+$/, '');

/**
 * The rake the table will actually open on - today's rate, not a pending one.
 *
 * A rake change inside its 7-day transition is not in force, and the server
 * opens the room on the effective rate regardless of what was last requested.
 * The same rule is applied here so the confirmation does not quote a number the
 * table will not charge. An unparseable `effectiveAt` counts as not yet due.
 */
function effectiveRakeBps(detail: LeagueDetail, now: number): number | null {
  if (!detail.settings) return null;
  const pending = detail.pendingRakeChange;
  if (pending) {
    const at = Date.parse(pending.effectiveAt);
    if (Number.isFinite(at) && at <= now) return pending.rakeBps;
  }
  return detail.settings.rakeBps;
}

export function CreateTableSheet({
  league,
  onClose,
}: {
  league: League | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const enterLeague = useContextStore((s) => s.enterLeague);
  const { confirm, sheet: confirmSheet } = useConfirmSheet();

  const [variantId, setVariantId] = useState<LeagueTableVariant>('texas');
  const [smallBlind, setSmallBlind] = useState('10');
  const [bigBlind, setBigBlind] = useState('20');
  const [seats, setSeats] = useState('6');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<LeagueTable | null>(null);

  const detail = useLeague(league?.leagueId ?? null);
  const create = useCreateLeagueTable();

  const close = (): void => {
    setCreated(null);
    setName('');
    create.reset();
    onClose();
  };

  const sb = int(smallBlind);
  const bb = int(bigBlind);
  const seatCount = int(seats);
  const blindsOk = sb > 0 && bb > 0 && sb < bb;
  const seatsOk = seatCount >= 2 && seatCount <= 9;
  const valid = blindsOk && seatsOk;

  const rakeBps = detail.data ? effectiveRakeBps(detail.data, Date.now()) : null;

  const submit = (): void => {
    if (!league || !valid) return;

    void (async () => {
      // Money-adjacent: this table's rake is real money and it goes to the
      // alliance, not the platform. Say so before it opens, in a Sheet.
      const ok = await confirm({
        title: t('alliance.tableConfirm'),
        body: t('alliance.tableConfirmBody', {
          sb,
          bb,
          seats: seatCount,
          rake: rakeBps === null ? '-' : pct(rakeBps),
        }),
        confirmLabel: t('alliance.tableCreateCta'),
      });
      if (!ok) return;

      create.mutate(
        {
          leagueId: league.leagueId,
          variantId,
          smallBlind: sb,
          bigBlind: bb,
          maxSeats: seatCount,
          ...(name.trim() ? { name: name.trim() } : {}),
        },
        {
          onSuccess: (table) => {
            toast.success(t('alliance.tableCreated'));
            setCreated(table);
          },
          onError: (e) => {
            // The friendly sentence goes on screen; the status and the server's
            // own wording stay in the console for whoever has to debug it.
            logError('createLeagueTable', e);
            toast.error(t(leagueTableErrorKey(e)));
          },
        },
      );
    })();
  };

  const goToTable = (): void => {
    if (!created || !league) return;
    // Enter the league first: the table is invisible from the platform lobby by
    // design, so arriving there in the wrong context shows nothing.
    enterLeague(league.leagueId, league.name);
    navigate(`/table/${created.tableId}`);
    close();
  };

  return (
    <>
      <Sheet open={league !== null} onClose={close} title={t('alliance.tableCreate')}>
        {created ? (
          <div className="space-y-3 p-4">
            <div className="space-y-2 rounded-(--radius-app) border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="shrink-0 text-brand" />
                <span className="min-w-0 truncate font-semibold">{created.name}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="brand">{t(`gameNames.${created.variantId}`)}</Badge>
                <Badge tone="neutral">
                  {t('alliance.tableBlindsValue', { sb: created.smallBlind, bb: created.bigBlind })}
                </Badge>
                <Badge tone="neutral">
                  {t('alliance.tableSeatsValue', { count: created.maxSeats })}
                </Badge>
                <Badge tone="accent">{t('alliance.tableRake', { pct: pct(created.rakeBps) })}</Badge>
              </div>
              <p className="text-[0.66rem] leading-relaxed text-dim">
                {t('alliance.tableInvisible')}
              </p>
            </div>

            <Button full onClick={goToTable}>
              {t('alliance.tableOpenCta')}
            </Button>
            <Button full variant="ghost" onClick={close}>
              {t('alliance.tableDone')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {detail.isPending && (
              <>
                <Skeleton className="h-10 w-full rounded-(--radius-app)" />
                <Skeleton className="h-24 w-full rounded-(--radius-app)" />
                <Skeleton className="h-11 w-full rounded-(--radius-app)" />
              </>
            )}

            {detail.isError && (
              <ErrorState message={t(errorKey(detail.error))} onRetry={() => void detail.refetch()} />
            )}

            {/* Not an error and not the player's fault: the alliance simply has
                no rake and buy-in yet, and the endpoint refuses until it does.
                Naming the missing settings is the whole point. */}
            {detail.isSuccess && !detail.data.settings && (
              <EmptyState
                icon={Settings2}
                title={t('alliance.tableNoSettings')}
                description={t('alliance.tableNoSettingsBlurb')}
              />
            )}

            {detail.isSuccess && detail.data.settings && (
              <>
                <p className="text-[0.66rem] leading-relaxed text-dim">{t('alliance.tableBlurb')}</p>

                <label className="block space-y-1">
                  <span className="text-[0.66rem] font-semibold text-dim">
                    {t('alliance.tableVariant')}
                  </span>
                  <Segmented
                    options={VARIANTS.map((v) => ({ value: v, label: t(`gameNames.${v}`) }))}
                    value={variantId}
                    onChange={setVariantId}
                  />
                </label>

                <div className="flex gap-2">
                  <label className="block flex-1 space-y-1">
                    <span className="text-[0.66rem] font-semibold text-dim">
                      {t('alliance.tableSmallBlind')}
                    </span>
                    <Input
                      value={smallBlind}
                      onChange={setSmallBlind}
                      type="number"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="block flex-1 space-y-1">
                    <span className="text-[0.66rem] font-semibold text-dim">
                      {t('alliance.tableBigBlind')}
                    </span>
                    <Input
                      value={bigBlind}
                      onChange={setBigBlind}
                      type="number"
                      inputMode="numeric"
                    />
                  </label>
                </div>
                {!blindsOk && (smallBlind.trim() !== '' || bigBlind.trim() !== '') && (
                  <p className="text-[0.66rem] text-danger">{t('alliance.tableBlindOrder')}</p>
                )}

                <label className="block space-y-1">
                  <span className="text-[0.66rem] font-semibold text-dim">
                    {t('alliance.tableSeats')}
                  </span>
                  <Input value={seats} onChange={setSeats} type="number" inputMode="numeric" />
                </label>
                {!seatsOk && seats.trim() !== '' && (
                  <p className="text-[0.66rem] text-danger">{t('alliance.tableSeatRange')}</p>
                )}

                <label className="block space-y-1">
                  <span className="text-[0.66rem] font-semibold text-dim">
                    {t('alliance.tableName')}
                  </span>
                  <Input
                    value={name}
                    // Input has no maxLength; the endpoint caps the name at 40
                    // and answers 400, so the cap is applied as it is typed.
                    onChange={(v) => setName(v.slice(0, MAX_NAME))}
                    placeholder={t('alliance.tableNamePlaceholder')}
                  />
                </label>

                {rakeBps !== null && (
                  <p className="text-[0.66rem] leading-relaxed text-dim">
                    {t('alliance.tableRakeNote', { pct: pct(rakeBps) })}
                  </p>
                )}

                <Button full disabled={!valid || create.isPending} onClick={submit}>
                  {create.isPending ? t('common.loading') : t('alliance.tableCreateCta')}
                </Button>
              </>
            )}
          </div>
        )}
      </Sheet>

      {confirmSheet}
    </>
  );
}

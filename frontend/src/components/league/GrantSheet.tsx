import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Coins } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useConfirmSheet } from '@/components/ui/ConfirmSheet';
import { useLeagueMembers, useGrantToMember } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { toast } from '@/lib/toast';
import { haptic } from '@/lib/telegram';
import { moneyFromDecimal } from '@/lib/money';
import { canGrant, type League, type LeagueMember } from '@/api/leagues';
import { cn } from '@/lib/cn';
import { useSession } from '@/store/session';

/**
 * Fund a member from the league's inventory.
 *
 * This is the league economy's missing middle. `LEAGUE_INVENTORY -> member
 * wallet` has existed as an endpoint since the grants PR, but nothing called
 * it — an owner could top the league up and still have no way to hand chips to
 * anybody without curling the API by hand.
 *
 * ── THIS MOVES REAL MONEY ────────────────────────────────────────────────────
 *
 * Three things follow from that, and none is decoration:
 *
 *   The amount is a STRING all the way to the ledger. It is never parsed to a
 *   number here — iron rule #2. `Number()` appears in this file only to
 *   validate, never to carry a value.
 *
 *   The idempotency key is minted ONCE per attempt, before the confirm, and
 *   reused if the request is retried. A double-submit is two requests; a key
 *   generated per request would differ between them and pay twice. Victor made
 *   exactly this point reviewing the grant endpoint.
 *
 *   The confirm names the player and the amount. A sheet that asks "are you
 *   sure?" without repeating what it is about is a rubber stamp.
 *
 * ── WHAT IT DOES NOT SHOW ────────────────────────────────────────────────────
 *
 * Member balances. The roster has no balance field to render — the server does
 * not return one. An owner funding the league has no business seeing what
 * members hold, and that stays structural rather than becoming a thing this
 * component remembers not to display.
 *
 * The league's own inventory balance is also absent, because no read exposes
 * it to a player. Rather than invent a figure, an over-spend surfaces as the
 * server's own refusal on submit. An em dash beats a made-up number, and a
 * wrong one on a funding screen is worse than none.
 */

/** Positive, at most 6 decimal places — the shape financial-core parses as Money. */
const AMOUNT = /^\d+(\.\d{1,6})?$/;

/**
 * A one-off key that makes a retried grant the same single payment.
 *
 * `crypto.randomUUID()` would read better and is wrong here: it requires a
 * SECURE CONTEXT, so it is undefined when the app is opened over http on a LAN
 * IP — which is exactly how this gets tested on a phone. `getRandomValues` has
 * no such restriction and is what clientSeed.ts already uses.
 *
 * Deliberately carries no league or player id. The server bounds `reference` at
 * 100 characters, and `grant-<leagueId>-<playerId>-<uuid>` can exceed that for
 * a long league id, which would fail the grant with "invalid grant" — a
 * confusing refusal for a request that is perfectly valid. The server scopes
 * the key by league and player anyway, so repeating them buys nothing.
 */
function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `grant-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function GrantSheet({ league, onClose }: { league: League | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { confirm, sheet: confirmSheet } = useConfirmSheet();
  const me = useSession((st) => st.player?.playerId ?? null);

  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  const members = useLeagueMembers(league?.leagueId ?? null);
  const grant = useGrantToMember();

  const close = (): void => {
    setSelected(null);
    setAmount('');
    grant.reset();
    onClose();
  };

  const valid = AMOUNT.test(amount.trim()) && Number(amount) > 0 && selected !== null;

  // Everyone except ME. Sending chips to yourself is not a grant, and the
  // ledger would refuse a transfer between one account and itself. Filtering on
  // the OWNER would be wrong: an ADMIN may grant too, and would then be offered
  // themselves as a recipient while the owner vanished from a list they belong
  // in.
  const recipients = useMemo(
    () => (members.data?.members ?? []).filter((m) => m.playerId !== me),
    [members.data, me],
  );

  const submit = async (): Promise<void> => {
    if (!league || !selected || !valid) return;

    const clean = amount.trim();
    // Minted BEFORE the confirm and captured in this closure: if the request is
    // retried, it is the same key and therefore the same single payment.
    const reference = idempotencyKey();

    const ok = await confirm({
      title: t('grants.confirmTitle'),
      body: t('grants.confirmBody', { amount: moneyFromDecimal(clean), player: shortId(selected) }),
      confirmLabel: t('grants.send'),
    });
    if (!ok) return;

    haptic('medium');
    grant.mutate(
      { leagueId: league.leagueId, playerId: selected, amount: clean, reference },
      {
        onSuccess: () => {
          toast.success(t('grants.sent'));
          setAmount('');
          setSelected(null);
        },
        // The server's own words: "insufficient inventory" and "not a member"
        // are different problems and the person funding needs to know which.
        onError: (e) => toast.error(t(errorKey(e))),
      },
    );
  };

  return (
    <>
      <Sheet open={league !== null} onClose={close} title={t('grants.title')}>
        {league && (
          <div className="space-y-4">
            <p className="text-[0.7rem] leading-relaxed text-dim">{t('grants.blurb')}</p>

            {members.isPending && <Skeleton className="h-24 w-full rounded-(--radius-app)" />}

            {members.isError && (
              <ErrorState message={t(errorKey(members.error))} onRetry={() => void members.refetch()} />
            )}

            {/* Offered from every league card, because knowing the role costs a
                roster fetch and doing that for every card on the page to grey
                out one button is not worth it. The check happens HERE, once the
                roster is loaded — before any form is filled in, rather than as
                a 403 after the confirm. */}
            {members.isSuccess && !canGrant(members.data.members, me) && (
              <EmptyState
                icon={Coins}
                title={t('grants.notAllowed')}
                description={t('grants.notAllowedBlurb')}
              />
            )}

            {members.isSuccess && canGrant(members.data.members, me) && recipients.length === 0 && (
              <EmptyState icon={Coins} title={t('grants.noMembers')} description={t('grants.noMembersBlurb')} />
            )}

            {members.isSuccess && canGrant(members.data.members, me) && recipients.length > 0 && (
              <>
                <div className="space-y-1">
                  <div className="px-1 text-[0.62rem] font-bold uppercase tracking-wide text-dim">
                    {t('grants.recipient')}
                  </div>
                  <ul className="max-h-52 space-y-1 overflow-y-auto">
                    {recipients.map((m) => (
                      <MemberRow
                        key={m.playerId}
                        member={m}
                        selected={selected === m.playerId}
                        onSelect={() => {
                          haptic('light');
                          setSelected(m.playerId);
                        }}
                      />
                    ))}
                  </ul>
                </div>

                <label className="block space-y-1">
                  <span className="px-1 text-[0.62rem] font-bold uppercase tracking-wide text-dim">
                    {t('grants.amount')}
                  </span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
                  />
                  {/* Only once they have typed something wrong — a validation
                      message shown before any input reads as an error. */}
                  {amount.trim() !== '' && !AMOUNT.test(amount.trim()) && (
                    <span className="px-1 text-[0.62rem] text-danger">{t('grants.amountInvalid')}</span>
                  )}
                </label>

                <Button full disabled={!valid || grant.isPending} onClick={() => void submit()}>
                  {grant.isPending ? t('common.loading') : t('grants.send')}
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

function MemberRow({
  member,
  selected,
  onSelect,
}: {
  member: LeagueMember;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left',
          selected ? 'border-brand bg-brand/10' : 'border-border bg-surface-2',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortId(member.playerId)}</span>
        <span className="shrink-0 text-[0.6rem] uppercase tracking-wide text-dim">
          {t(`grants.role.${member.role}`, { defaultValue: member.role })}
        </span>
      </button>
    </li>
  );
}

/** Ids are long; the head and tail are what a human matches on. */
const shortId = (id: string): string => (id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`);


/**
 * The entry point, which renders NOTHING for someone who cannot grant.
 *
 * The house rule is that a control only some people can use does not belong
 * where everyone sees it. Knowing that requires the caller's role, which until
 * the roster endpoint existed no readable endpoint exposed — which is why the
 * neighbouring "new table" button is shown to every member and left to the
 * server to refuse.
 *
 * The roster fetch is not an extra cost: it uses the same query key the sheet
 * does, so opening the sheet hits a warm cache instead of loading again.
 */
export function FundMembersButton({
  league,
  onOpen,
  children,
}: {
  league: League;
  onOpen: () => void;
  children: ReactNode;
}) {
  const me = useSession((st) => st.player?.playerId ?? null);
  const members = useLeagueMembers(league.leagueId);

  // Nothing while it loads, rather than a button that appears a beat later:
  // a control that pops in after the page settles invites a mis-tap.
  if (!members.isSuccess || !canGrant(members.data.members, me)) return null;

  return (
    <Button size="sm" variant="secondary" onClick={onOpen}>
      <Coins size={14} />
      {children}
    </Button>
  );
}

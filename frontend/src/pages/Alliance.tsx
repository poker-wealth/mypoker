import { Crown, Plus, Trophy, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

/**
 * Tab 1 — Alliance (club) lobby: the alliance you belong to, alliances you could
 * join, and the create/ranking entry points.
 *
 * Presentational for now. The league/club system exists on the game-server
 * (`src/league`) but has no client-facing endpoint yet, so this renders from the
 * sample below and is marked as such — same convention as Lobby/Games. Swap
 * SAMPLE_* for query hooks when the endpoints land; the markup shouldn't change.
 */

const MY_ALLIANCE = {
  name: 'Dragon Alliance',
  id: '123456',
  members: 2451,
  online: 342,
  vip: true,
};

const RECOMMENDED = [
  { name: 'Phoenix Club', members: 1892, online: 296, vip: true, icon: '/brand/flame.png' },
  { name: 'King Poker', members: 1563, online: 201, vip: false, icon: '/brand/crown.png' },
  { name: 'Ace Club', members: 1231, online: 178, vip: false, icon: '/brand/spade.png' },
  { name: 'Elite Alliance', members: 987, online: 153, vip: false, icon: '/brand/shield.png' },
];

export function Alliance() {
  return (
    <div className="space-y-4">


      {/* My alliance */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-4"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.14 }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div
              className="grid size-12 shrink-0 place-items-center rounded-xl text-lg font-black text-white"
              style={{ backgroundImage: 'var(--brand-gradient)' }}
            >
              {MY_ALLIANCE.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold">{MY_ALLIANCE.name}</span>
                {MY_ALLIANCE.vip && (
                  <Badge tone="accent">
                    <Crown size={10} className="mr-0.5" /> VIP
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-dim">ID: {MY_ALLIANCE.id}</div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs text-dim">
            <span>
              <span className="font-semibold text-text">
                {MY_ALLIANCE.members.toLocaleString()}
              </span>{' '}
              members
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" />
              <span className="font-semibold text-text">{MY_ALLIANCE.online}</span> online
            </span>
          </div>

          <Button full className="mt-3.5">
            Join Alliance
          </Button>
        </div>
      </div>

      {/* Recommended */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-bold">Recommended alliances</h2>
          <button className="flex items-center text-xs text-dim">
            View all <ChevronRight size={14} />
          </button>
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
          {RECOMMENDED.map((a) => (
            <div key={a.name} className="flex items-center gap-3 p-3">
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 p-1.5 shadow-inner">
                <img src={a.icon} alt="" className="size-full object-contain drop-shadow-md" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  {a.vip && <Badge tone="accent">VIP</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[0.68rem] text-dim">
                  <span>{a.members.toLocaleString()} members</span>
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-success" />
                    {a.online} online
                  </span>
                </div>
              </div>
              <Button size="sm" variant="secondary">
                Join
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button className="flex flex-col items-center gap-1.5 rounded-(--radius-app) border border-border bg-surface py-4 active:scale-[0.98]">
          <Plus size={20} className="text-brand" />
          <span className="text-xs font-semibold">Create Alliance</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 rounded-(--radius-app) border border-border bg-surface py-4 active:scale-[0.98]">
          <Trophy size={20} className="text-accent" />
          <span className="text-xs font-semibold">Alliance Ranking</span>
        </button>
      </div>

      <div className="pt-1 text-center text-[0.66rem] text-dim">
        Sample data — awaiting the alliance/league endpoints.
      </div>
    </div>
  );
}

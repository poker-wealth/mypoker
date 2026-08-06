import { useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, Filter, Zap } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';

const TABLES = [
  { id: 'T-001', blinds: '1/2', players: '6/9', buyIn: '42 BB', status: 'play', minBuy: '$1,200' },
  { id: 'T-002', blinds: '1/2', players: '8/9', buyIn: '38 BB', status: 'play', minBuy: '$980' },
  { id: 'T-003', blinds: '5/10', players: '7/9', buyIn: '88 BB', status: 'play', minBuy: '$2,100' },
  { id: 'T-004', blinds: '5/10', players: '9/9', buyIn: '112 BB', status: 'wait', minBuy: 'WAIT' },
  { id: 'T-005', blinds: '25/50', players: '6/9', buyIn: '240 BB', status: 'play', minBuy: '$8,900' },
  { id: 'T-006', blinds: '100/200', players: '9/9', buyIn: '512 BB', status: 'wait', minBuy: 'WAIT' },
];

export function Lobby() {
  const [variant, setVariant] = useState('dezhou');
  const [blinds, setBlinds] = useState('all');

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-end pb-1 pt-2">
        <div className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
          <ShieldCheck size={14} /> FAIR & SECURE
        </div>
      </div>

      {/* Jackpot hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5 text-center"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.9 }} />
        {/* moving shimmer */}
        <motion.div
          className="absolute inset-y-0 w-1/3 bg-white/20 blur-2xl"
          initial={{ x: '-120%' }}
          animate={{ x: '360%' }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
        />
        <div className="relative text-white">
          <div className="text-[0.7rem] font-bold uppercase tracking-wider text-white/80">
            Grand Jackpot
          </div>
          <div className="mt-0.5 text-[2.2rem] font-black leading-none tracking-tight tabular-nums text-yellow-400">
            $ 1,253,842.28
          </div>
          <div className="mt-1 text-xs font-semibold text-success drop-shadow-sm">+ $322.16 / hr</div>
        </div>
      </div>

      <Segmented
        value={variant}
        onChange={setVariant}
        options={[
          { value: 'dezhou', label: 'DEZHOU' },
          { value: 'xuzhou', label: 'XUZHOU' },
          { value: 'ausha', label: 'AUSHA' },
          { value: 'macau', label: 'MACAU' },
          { value: 'others', label: 'OTHERS' },
        ]}
      />

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Segmented
            value={blinds}
            onChange={setBlinds}
            options={[
              { value: 'all', label: 'ALL' },
              { value: '1/2', label: '1/2' },
              { value: '5/10', label: '5/10' },
              { value: '25/50', label: '25/50' },
              { value: '100/200', label: '100/200' },
            ]}
          />
        </div>
        <button className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-dim transition-colors hover:text-text">
          <Filter size={16} />
        </button>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-auto rounded-(--radius-app) border border-border bg-surface">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border/50 text-[0.65rem] text-dim">
              <th className="px-3 py-2.5 font-medium">Table</th>
              <th className="px-3 py-2.5 font-medium">Blinds</th>
              <th className="px-3 py-2.5 font-medium">Players</th>
              <th className="px-3 py-2.5 font-medium">Buy-in</th>
              <th className="px-3 py-2.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {TABLES.map((t) => (
              <tr key={t.id} className="transition-colors active:bg-surface-2">
                <td className="px-3 py-3 font-semibold text-yellow-500">{t.id}</td>
                <td className="px-3 py-3 tabular-nums text-dim">{t.blinds}</td>
                <td className="px-3 py-3 tabular-nums">{t.players}</td>
                <td className="px-3 py-3 tabular-nums">{t.buyIn}</td>
                <td className="px-3 py-3 text-right">
                  <span
                    className={`font-semibold ${
                      t.status === 'play' ? 'text-success' : 'text-dim'
                    }`}
                  >
                    {t.minBuy}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Button className="bg-success text-success-fg hover:bg-success/90">
          <Zap size={16} className="mr-1.5" /> QUICK JOIN
        </Button>
        <Button variant="secondary" className="border-border bg-surface text-dim">
          CREATE PRIVATE TABLE
        </Button>
      </div>
    </div>
  );
}

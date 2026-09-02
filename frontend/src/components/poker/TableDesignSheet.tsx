import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import { Sheet } from '@/components/ui/Sheet';
import { useTranslation } from 'react-i18next';
import { PICKABLE_DESIGNS, type TableDesign } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';
import { cn } from '@/lib/cn';

/**
 * Pick a table.
 *
 * Each option shows the actual felt rather than a swatch — the whole reason to offer a choice is
 * how the table looks, so the choice is made by looking at it. The pick is saved, so the felt you
 * chose is the one waiting next time you sit down.
 *
 * Only the PICKABLE felts are listed. Each landscape table is reached by
 * choosing its portrait sibling — pick Midnight Blue and Short Deck gives you
 * the blue wide felt — so listing the wide ones here would offer the same
 * choice twice and let someone select a landscape table for a portrait game.
 *
 * The tick therefore sits on what the player chose, which is always what is
 * driving the felt on screen even when the game changes its shape.
 */
export function TableDesignSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const current = useTableDesign((s) => s.id);
  const setDesign = useTableDesign((s) => s.setDesign);

  return (
    <Sheet open={open} onClose={onClose} title={t('table.tableDesign')}>
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        {PICKABLE_DESIGNS.map((design) => (
          <button
            key={design.id}
            onClick={() => {
              setDesign(design.id);
              onClose();
            }}
            className={cn(
              'group relative overflow-hidden rounded-(--radius-app) border-2 p-2 text-left transition-colors',
              design.id === current ? 'border-brand bg-surface-2' : 'border-border bg-surface',
            )}
          >
            <div className="relative mx-auto flex h-28 items-center justify-center overflow-hidden rounded-lg bg-black/40">
              <DesignThumb design={design} />
              {design.id === current && (
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full text-white shadow"
                  style={{ backgroundImage: 'var(--brand-gradient)' }}
                >
                  <Check size={13} strokeWidth={3} />
                </motion.div>
              )}
            </div>
            <div className="mt-2 text-[0.8rem] font-bold">{design.name}</div>
            <div className="text-[0.65rem] leading-tight text-dim">{design.blurb}</div>
          </button>
        ))}
      </div>
      <p className="px-4 pt-4 text-center text-[0.68rem] text-dim">
        Only the felt changes — the seats, the cards and the hand stay exactly where they are.
      </p>
    </Sheet>
  );
}

/** A small likeness of the table: the artwork itself, or a miniature of the CSS felt. */
function DesignThumb({ design }: { design: TableDesign }) {
  if (design.artUrl) {
    return (
      <img
        src={design.artUrl}
        alt={design.name}
        draggable={false}
        className="h-full w-full object-contain"
      />
    );
  }
  return (
    <div
      className="h-[92%] rounded-[50%] border-2"
      style={{
        aspectRatio: design.aspect,
        borderColor: 'var(--brand-2)',
        background:
          'radial-gradient(ellipse at 50% 42%, #1e3f74 0%, var(--felt) 45%, #0a162c 80%, #060d1c 100%)',
        boxShadow: '0 0 14px color-mix(in srgb, var(--brand-2) 55%, transparent)',
      }}
    />
  );
}

import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import { Sheet } from '@/components/ui/Sheet';
import { useTranslation } from 'react-i18next';
import { PICKABLE_DESIGNS, groundFor, type TableDesign } from '@/lib/tableDesigns';
import { useTableDesign } from '@/store/tableDesign';
import { cn } from '@/lib/cn';

/**
 * Pick a table COLOUR.
 *
 * Each option is a plain swatch of the ground colour, painted with the same
 * `groundFor` the table uses — there is no felt to preview any more. The felts
 * were removed (owner: "all table design goes... just the colour na but no
 * tables on it") and this sheet was left showing artwork for tables that are
 * no longer drawn. The pick is saved, so the colour you
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
            {/* The name alone. `design.blurb` described the felt — "casino
                green felt on a tournament rail", "burgundy cloth and gold
                fittings" — and every one of those describes something that is
                no longer drawn. */}
            <div className="mt-2 text-[0.8rem] font-bold">{design.name}</div>
          </button>
        ))}
      </div>
      <p className="px-4 pt-4 text-center text-[0.68rem] text-dim">{t('table.designBlurb')}</p>
    </Sheet>
  );
}

/**
 * A plain swatch of the GROUND COLOUR — no table on it.
 *
 * This used to render the design's felt artwork, or a miniature oval of the
 * CSS felt. Both were left advertising tables that are no longer drawn: the
 * felts were removed and a design now selects only the colour behind the
 * seats. A picker showing a green tournament rail, for a choice that produces
 * no rail at all, is a promise the table cannot keep.
 *
 * Exactly `groundFor` — the same function the table paints with — so the
 * swatch and the felt can never disagree about what a colour looks like.
 */
function DesignThumb({ design }: { design: TableDesign }) {
  return (
    <div
      className="h-full w-full rounded-lg"
      style={{ background: groundFor(design) }}
    />
  );
}

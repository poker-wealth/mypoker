import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Globe } from 'lucide-react';
import { LANGUAGES } from '@/i18n/languages';
import { setLanguage, storedLanguage } from '@/i18n';
import { haptic } from '@/lib/telegram';

/**
 * First-launch language chooser.
 *
 * Shown once, when no language has ever been picked, and never again — the
 * choice is persisted and every later launch goes straight into the app.
 *
 * Deliberately free of prose. We do not know what this player reads yet, so a
 * sentence explaining the screen would be unreadable to most of the people who
 * need it. The globe carries the meaning and every option is written in its own
 * script, which is the only labelling that works when the reader's language is
 * the unknown.
 *
 * This is what makes "everyone opens in 中文" safe: a Japanese or Brazilian
 * player is no longer stranded on a screen they cannot read, they just pick on
 * the way in.
 */
export function LanguageGate() {
  // Read once, on mount: this is a first-launch decision, and re-deriving it
  // during the session would make the gate flicker back after a sign-out clears
  // other storage.
  const [needsChoice, setNeedsChoice] = useState(() => storedLanguage() === null);

  const choose = (code: string): void => {
    haptic('light');
    setLanguage(code);
    setNeedsChoice(false);
  };

  return (
    <AnimatePresence>
      {needsChoice && (
        <motion.div
          // Above the toast and connection layers: nothing else should be
          // interactive until a language exists.
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-bg px-6"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="dialog"
          aria-modal="true"
          aria-label="Language / 语言"
        >
          <div className="mb-7 flex flex-col items-center gap-3">
            <div
              className="grid size-14 place-items-center rounded-2xl text-white"
              style={{ backgroundImage: 'var(--brand-gradient)' }}
            >
              <Globe size={26} />
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">语言</div>
              <div className="text-sm text-dim">Language</div>
            </div>
          </div>

          <div className="w-full max-w-[340px] overflow-y-auto">
            <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => choose(lang.code)}
                  lang={lang.code}
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left font-medium active:bg-surface-2"
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

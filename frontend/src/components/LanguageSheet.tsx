import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { LANGUAGES } from '@/i18n/languages';
import { setLanguage } from '@/i18n';
import { haptic } from '@/lib/telegram';
import { useUpdateSettings } from '@/api/hooks';
import { useSession } from '@/store/session';

/**
 * Language picker. Each option is labelled in its own language, so it stays
 * usable even if the player has switched to something they can't read and needs
 * to find their way back.
 *
 * The choice is written twice: to i18next and localStorage so the UI turns over
 * instantly and survives being signed out, and — when signed in — to the account
 * so a reinstall or a second device doesn't lose it. The local write is never
 * skipped in favour of the remote one; a failed request must not leave the
 * player looking at a language they didn't pick.
 */
export function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const update = useUpdateSettings();

  return (
    <Sheet open={open} onClose={onClose} title={t('language.title')}>
      <div className="m-4 divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border">
        {LANGUAGES.map((lang) => {
          const active = i18n.resolvedLanguage === lang.code;
          return (
            <button
              key={lang.code}
              onClick={() => {
                haptic('light');
                setLanguage(lang.code);
                if (signedIn) update.mutate({ language: lang.code });
                onClose();
              }}
              className="flex w-full items-center justify-between bg-surface px-4 py-3.5 text-left active:bg-surface-2"
            >
              <span className={active ? 'font-semibold text-brand' : 'font-medium'}>
                {lang.label}
              </span>
              {active && <Check size={18} className="text-brand" />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

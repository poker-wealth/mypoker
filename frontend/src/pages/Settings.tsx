import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Volume2, Vibrate, Trophy, Wallet, Megaphone, Languages, ShieldCheck, LifeBuoy, Sun, Moon, LogOut } from 'lucide-react';
import { ListRow } from '@/components/ui/ListRow';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Switch } from '@/components/ui/Switch';
import { Avatar } from '@/components/ui/Avatar';
import { LanguageSheet } from '@/components/LanguageSheet';
import { useSettings, useUpdateSettings } from '@/api/hooks';
import { errorKey } from '@/api/errors';
import { useSession } from '@/store/session';
import { useTheme } from '@/store/theme';
import { SUPPORT_URL } from '@/config';
import { LANGUAGES } from '@/i18n/languages';
import { toast } from '@/store/toast';
import type { SettingsPatch } from '@/api/settings';

/**
 * Settings — account-scoped, so preferences follow the player to a new device.
 *
 * Theme is the deliberate exception: it stays local. It's a property of the
 * screen you're looking at, not of the account, and syncing it would mean a
 * phone in daylight forcing dark mode onto a desktop at night.
 *
 * Language writes to both — i18next immediately so the UI turns over now, and
 * the account so a reinstall doesn't lose it.
 */
export function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const player = useSession((s) => s.player);
  const signOut = useSession((s) => s.signOut);
  const { resolved: theme, toggle: toggleTheme } = useTheme();
  const [languageOpen, setLanguageOpen] = useState(false);

  const settings = useSettings();
  const update = useUpdateSettings();

  const currentLanguage = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.label ?? '';

  const set = (patch: SettingsPatch): void => {
    update.mutate(patch);
  };

  return (
    <div className="space-y-4">
      {/* Appearance — local by design, so it works signed out too. */}
      <Section title={t('settings.appearance')}>
        <ListRow
          title={t('settings.theme')}
          leading={
            theme === 'dark' ? (
              <Moon size={18} className="text-dim" />
            ) : (
              <Sun size={18} className="text-accent" />
            )
          }
          trailing={<Switch checked={theme === 'dark'} onChange={toggleTheme} />}
        />
        <ListRow
          title={t('account.language')}
          leading={<Languages size={18} className="text-brand" />}
          value={currentLanguage}
          onClick={() => setLanguageOpen(true)}
        />
      </Section>

      {!signedIn && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <EmptyState icon={Volume2} title={t('settings.signInToSync')} />
        </div>
      )}

      {signedIn && settings.isPending && (
        <Section title={t('settings.preferences')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </Section>
      )}

      {signedIn && settings.isError && (
        <div className="rounded-(--radius-app) border border-border bg-surface">
          <ErrorState
            message={t(errorKey(settings.error))}
            onRetry={() => void settings.refetch()}
          />
        </div>
      )}

      {signedIn && settings.isSuccess && (
        <>
          <Section title={t('settings.preferences')}>
            <ListRow
              title={t('settings.sound')}
              leading={<Volume2 size={18} className="text-brand" />}
              trailing={
                <Switch
                  checked={settings.data.sound}
                  onChange={(v) => set({ sound: v })}
                />
              }
            />
            <ListRow
              title={t('settings.haptics')}
              leading={<Vibrate size={18} className="text-accent" />}
              trailing={
                <Switch
                  checked={settings.data.haptics}
                  onChange={(v) => set({ haptics: v })}
                />
              }
            />
          </Section>

          <Section title={t('settings.notifications')}>
            <ListRow
              title={t('settings.notifyResults')}
              leading={<Trophy size={18} className="text-brand" />}
              trailing={
                <Switch
                  checked={settings.data.notifyResults}
                  onChange={(v) => set({ notifyResults: v })}
                />
              }
            />
            <ListRow
              title={t('settings.notifyDeposits')}
              leading={<Wallet size={18} className="text-success" />}
              trailing={
                <Switch
                  checked={settings.data.notifyDeposits}
                  onChange={(v) => set({ notifyDeposits: v })}
                />
              }
            />
            <ListRow
              title={t('settings.notifyPromos')}
              leading={<Megaphone size={18} className="text-dim" />}
              trailing={
                <Switch
                  checked={settings.data.notifyPromos}
                  onChange={(v) => set({ notifyPromos: v })}
                />
              }
            />
          </Section>
        </>
      )}

      {signedIn && player && (
        <Section title={t('settings.account')}>
          <ListRow
            title={player.displayName}
            leading={
              <Avatar
                avatarId={settings.data?.avatarId}
                playerId={player.playerId}
                photoUrl={player.photoUrl}
                name={player.displayName}
                size={18}
              />
            }
            value={player.username ? `@${player.username}` : `ID: ${player.playerId.slice(0, 14)}…`}
          />
          <ListRow
            title={t('account.signOut')}
            leading={<LogOut size={18} className="text-danger" />}
            onClick={() => {
              signOut();
              navigate('/');
            }}
          />
        </Section>
      )}

      <Section title={t('settings.about')}>
        <ListRow
          title={t('account.fairness')}
          leading={<ShieldCheck size={18} className="text-accent" />}
          onClick={() => navigate('/fairness')}
        />
        <ListRow
          title={t('account.support')}
          leading={<LifeBuoy size={18} className="text-dim" />}
          onClick={() => {
            if (SUPPORT_URL) {
              window.open(SUPPORT_URL, '_blank', 'noopener');
            } else {
              toast.info(t('account.supportConnecting', { defaultValue: 'Connecting to support...' }));
            }
          }}
        />
      </Section>

      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dim">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-(--radius-app) border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

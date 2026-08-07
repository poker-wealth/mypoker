import { HelpCircle, Settings, ShieldCheck, Bell } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUnreadCount } from '@/api/hooks';

/**
 * Route-specific header, per the approved mockup: the screen's name on the left
 * and a contextual control on the right.
 *
 * Titles come from the nav translation keys rather than being written in, so the
 * header follows the language the rest of the app is in. The mockup shows them
 * in English because the mockup is in English.
 *
 * The notification bell is appended to whatever the route's own control is,
 * rather than replacing it — and only when the count is above zero, since a
 * permanently empty bell is a button that has never rewarded a tap.
 */
export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const unread = useUnreadCount();

  let title = '';
  let rightElement = null;

  switch (location.pathname) {
    case '/alliance':
      title = t('nav.alliance');
      rightElement = <HelpCircle size={18} className="text-dim" />;
      break;
    case '/games':
      title = t('nav.games');
      break;
    case '/':
      title = t('nav.lobby');
      rightElement = (
        <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-success">
          <ShieldCheck size={13} /> {t('lobby.fairSecure')}
        </div>
      );
      break;
    case '/data':
      title = t('nav.data');
      rightElement = (
        <button onClick={() => navigate('/settings')} aria-label={t('account.settings')}>
          <Settings size={18} className="text-dim" />
        </button>
      );
      break;
    case '/profile':
      title = '';
      rightElement = (
        <button onClick={() => navigate('/settings')} aria-label={t('account.settings')}>
          <Settings size={18} className="text-dim" />
        </button>
      );
      break;
    default:
      title = 'MYPOKER';
      break;
  }

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-1 bg-bg/95 px-4 pb-3 pt-4 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-black tracking-tight">{title}</h1>
        <div className="flex items-center gap-2">
          {(unread.data ?? 0) > 0 && (
            <button
              onClick={() => navigate('/notifications')}
              aria-label={t('notifications.title')}
              className="relative grid size-8 place-items-center text-dim active:scale-95"
            >
              <Bell size={18} />
              <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.55rem] font-bold text-white">
                {unread.data! > 9 ? '9+' : unread.data}
              </span>
            </button>
          )}
          {rightElement}
        </div>
      </div>
    </header>
  );
}

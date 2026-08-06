import { HelpCircle, Settings, ShieldCheck, ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Route-specific headers based on the active tab.
 */
export function Header() {
  const location = useLocation();
  const navigate = useNavigate();

  let title = '';
  let rightElement = null;
  let showBack = false;

  switch (location.pathname) {
    case '/alliance':
      title = 'ALLIANCE';
      rightElement = <HelpCircle size={18} className="text-dim" />;
      break;
    case '/games':
      title = 'GAMES';
      break;
    case '/':
      title = 'LOBBY';
      rightElement = (
        <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[0.65rem] font-bold text-success uppercase tracking-wide">
          <ShieldCheck size={13} /> FAIR & SECURE
        </div>
      );
      break;
    case '/data':
      title = 'STATS';
      rightElement = <Settings size={18} className="text-dim cursor-pointer hover:text-text" onClick={() => navigate('/settings')} />;
      break;
    case '/profile':
      title = '';
      rightElement = <Settings size={18} className="text-dim cursor-pointer hover:text-text" onClick={() => navigate('/settings')} />;
      break;
    case '/settings':
      title = 'SETTINGS';
      showBack = true;
      break;
    case '/wallet':
      title = 'WALLET';
      showBack = true;
      break;
    case '/fairness':
      title = 'FAIRNESS';
      showBack = true;
      break;
    default:
      title = 'MY POKER';
      break;
  }

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-1 bg-bg/95 px-4 pb-3 pt-4 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {showBack && (
            <button onClick={() => navigate(-1)} className="flex items-center justify-center p-1 -ml-1 text-dim hover:text-text transition-colors">
              <ChevronLeft size={22} />
            </button>
          )}
          <h1 className="text-base font-black tracking-tight">{title}</h1>
        </div>
        <div>{rightElement}</div>
      </div>
    </header>
  );
}

import { HelpCircle, Settings, ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';

/**
 * Route-specific headers based on the active tab.
 */
export function Header() {
  const location = useLocation();

  let title = '';
  let rightElement = null;

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
      rightElement = <Settings size={18} className="text-dim" />;
      break;
    case '/profile':
      title = '';
      rightElement = <Settings size={18} className="text-dim" />;
      break;
    default:
      title = 'MY POKER';
      break;
  }

  return (
    <header className="sticky top-0 z-20 -mx-4 mb-1 bg-bg/95 px-4 pb-3 pt-4 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-black tracking-tight">{title}</h1>
        <div>{rightElement}</div>
      </div>
    </header>
  );
}

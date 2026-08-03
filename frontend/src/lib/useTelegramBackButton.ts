import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tg } from './telegram';

/**
 * Wires Telegram's native BackButton to the router: it appears on any non-root
 * screen and pops history when tapped. No-op in a plain browser.
 */
export function useTelegramBackButton(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname === '/';

  useEffect(() => {
    const back = tg()?.BackButton;
    if (!back) return;

    const handler = () => navigate(-1);
    back.onClick(handler);
    if (isRoot) back.hide();
    else back.show();

    return () => back.offClick(handler);
  }, [isRoot, navigate]);
}

import { Navigate } from 'react-router-dom';
import { Lobby } from '@/pages/Lobby';
import { isTelegram } from '@/lib/telegram';
import { useSession } from '@/store/session';

/**
 * Who is at the front door decides what the front door is.
 *
 * Inside Telegram the Mini App opens at `/` and must land in the game; a
 * signed-in browser player likewise. A stranger in a plain browser gets the
 * landing page — redirected (not inlined) so it renders outside AppShell,
 * without the app's tab bar around a marketing page.
 *
 * A component, not a decision made at module load: the session is read at
 * render time, so signing out and coming back to `/` shows the landing
 * rather than whatever was true when the bundle first evaluated.
 */
export function HomeIndex() {
  const token = useSession((s) => s.token);
  if (isTelegram() || token) return <Lobby />;
  return <Navigate to="/download" replace />;
}

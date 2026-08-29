import { useEffect } from 'react';
import { useSettings } from '@/api/hooks';
import { setSoundEnabled } from '@/lib/sound';

/**
 * Keep the sound engine in step with the player's saved preference.
 *
 * The preference lives server-side (it follows the account, not the device), so
 * it arrives asynchronously. Until it does, sound stays OFF — a muted player
 * whose first hand made noise while their settings loaded would reasonably
 * conclude the toggle does not work.
 *
 * Mounted once, on the table. Anywhere that plays a cue simply calls `play()`
 * and does not need to know whether the player wants to hear it.
 */
export function useSoundSetting(): void {
  const settings = useSettings();
  const on = settings.isSuccess ? settings.data.sound : false;

  useEffect(() => {
    setSoundEnabled(on);
  }, [on]);
}

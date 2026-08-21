import { useEffect, useState } from 'react';
import type { TableSocket } from './tableSocket';

/**
 * "Somebody has challenged you to prove you are human."
 *
 * The bot check does not travel in the snapshot: the room sends `prompt_challenge` to the TARGET
 * ONLY (see game-server/src/live/poker-room.ts), so a hook that watched state would never see it.
 *
 * Arriving at all means it is for you — the server addressed it to one viewer. There is nothing to
 * filter here, and filtering on a client-side idea of "am I the target" would only add a way to
 * miss a challenge the server intended you to answer.
 */
export function useChallengePrompt(socket: TableSocket | null): {
  challengerId: string | null;
  clear: () => void;
} {
  const [challengerId, setChallengerId] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const onPrompt = (data: unknown): void => {
      const d = data as { challengerId?: string };
      // Falls back to a marker rather than dropping the prompt: an unanswered bot check counts
      // against the player, so a malformed payload must not be the reason they never saw it.
      setChallengerId(d.challengerId ?? 'unknown');
    };

    socket.on('prompt_challenge', onPrompt);
    return () => {
      socket.off('prompt_challenge', onPrompt);
    };
  }, [socket]);

  return { challengerId, clear: () => setChallengerId(null) };
}

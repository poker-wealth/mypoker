import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_DESIGN_ID } from './tableDesigns';

/**
 * Which felt this player picked, remembered between sessions.
 *
 * The Mini App keeps this in a persisted zustand store. There is no zustand here and one preference
 * does not justify adding it, so this is a module-level value plus a subscriber list — the same
 * shape, a tenth of the code, no dependency.
 *
 * WHY SECURE STORE FOR SOMETHING THAT IS NOT A SECRET
 *
 * It is the only key/value store already in this project (see `src/session.ts`, which uses it for
 * the auth token, correctly). AsyncStorage would be the conventional home for a preference, but it
 * is a new native dependency and a rebuild for one string. A felt choice leaks nothing if it sits
 * in the Keychain; it is over-protected, not wrongly protected. If AsyncStorage arrives later for
 * other reasons, move this and leave the token where it is.
 *
 * Reads are async and the app must draw before one finishes, so the default felt shows first and
 * the stored choice replaces it. That is a visible swap on a cold start — acceptable for a
 * background, and much better than blocking the table on a disk read.
 */

const KEY = 'table.design';

let current = DEFAULT_DESIGN_ID;
let loaded = false;
const listeners = new Set<(id: string) => void>();

function emit(): void {
  for (const l of listeners) l(current);
}

/** Read the stored choice once, then tell anyone already mounted. */
async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const saved = await SecureStore.getItemAsync(KEY);
    if (saved && saved !== current) {
      current = saved;
      emit();
    }
  } catch {
    // A preference that cannot be read is not worth surfacing — the default felt is a fine table.
  }
}

/**
 * The chosen design id, and a setter.
 *
 * The write is fire-and-forget: the choice applies immediately either way, and a table that stalls
 * on a disk write to change its background would be a worse bug than a preference that fails to
 * persist.
 */
export function useTableDesign(): { id: string; setDesign: (id: string) => void } {
  const [id, setId] = useState(current);

  useEffect(() => {
    listeners.add(setId);
    void load();
    return () => {
      listeners.delete(setId);
    };
  }, []);

  const setDesign = (next: string): void => {
    if (next === current) return;
    current = next;
    emit();
    void SecureStore.setItemAsync(KEY, next).catch(() => {});
  };

  return { id, setDesign };
}

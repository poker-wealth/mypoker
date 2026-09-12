import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

/**
 * How THIS DEVICE draws the table — the native twin of
 * `frontend/src/store/tablePrefs.ts`.
 *
 * Deliberately local rather than on the account, for the same reasons as the
 * web: a four-colour deck, a default raise size, whether the bet control asks
 * before committing, and whether the insurance prompt is hidden at one table
 * change nothing the server does, are invisible to other players, and are not
 * worth a round trip mid-hand. Game sound is the exception and is NOT here — it
 * lives on the account so muting follows a player to their other devices.
 *
 * SECURE STORE, like `tableDesignStore` next door and for the same reason: it
 * is the only key/value store this project already has (see `src/session.ts`).
 * AsyncStorage would be the conventional home for preferences but is a new
 * native dependency and a rebuild for a handful of booleans. These are
 * over-protected sitting in the Keychain, not wrongly protected.
 *
 * Zustand IS available here (package.json), despite the older comment in
 * `tableDesignStore` saying otherwise — that note predates it being added.
 */

/** Pot fractions offered as one-tap raise sizes. Same ids as the web. */
export const RAISE_PRESETS = [
  { id: 'half', label: '1/2', fraction: 0.5 },
  { id: 'twoThirds', label: '2/3', fraction: 2 / 3 },
  { id: 'pot', label: '1x', fraction: 1 },
] as const;

export type RaisePresetId = (typeof RAISE_PRESETS)[number]['id'];

interface TablePrefs {
  /** Four-colour deck: diamonds blue, clubs green. */
  fourColour: boolean;
  setFourColour: (on: boolean) => void;

  /** Which pot fraction the raise control opens on. */
  defaultRaise: RaisePresetId;
  setDefaultRaise: (id: RaisePresetId) => void;

  /** A custom raise in big blinds, or null to use `defaultRaise`. Never zero. */
  customRaise: number | null;
  setCustomRaise: (bb: number | null) => void;

  /** Chat and emote sounds, separate from the game's own cues. */
  chatSound: boolean;
  setChatSound: (on: boolean) => void;

  /** Ask before committing a bet. */
  confirmBets: boolean;
  setConfirmBets: (on: boolean) => void;

  /**
   * Tables whose insurance prompt is hidden, by id.
   *
   * PER TABLE, because that is what the control says. A global flag behind a
   * "this table only" label would silently suppress a money decision at every
   * other table a player sits at.
   */
  hideInsuranceFor: string[];
  setHideInsurance: (tableId: string, hidden: boolean) => void;
}

/**
 * SecureStore as a zustand storage adapter.
 *
 * Its API is `getItemAsync`/`setItemAsync`, not the `getItem`/`setItem` shape
 * zustand expects, so it is adapted rather than passed straight in. Every call
 * swallows its own failure: a locked keychain must cost a preference, never the
 * table.
 */
const secureStorage = createJSONStorage(() => ({
  getItem: (name: string) => SecureStore.getItemAsync(name).catch(() => null),
  setItem: (name: string, value: string) =>
    SecureStore.setItemAsync(name, value).catch(() => undefined),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name).catch(() => undefined),
}));

export const useTablePrefs = create<TablePrefs>()(
  persist(
    (set) => ({
      fourColour: false,
      setFourColour: (fourColour) => set({ fourColour }),

      defaultRaise: 'pot',
      setDefaultRaise: (defaultRaise) => set({ defaultRaise }),

      customRaise: null,
      setCustomRaise: (customRaise) =>
        set({ customRaise: customRaise !== null && customRaise > 0 ? customRaise : null }),

      chatSound: true,
      setChatSound: (chatSound) => set({ chatSound }),

      // OFF by default: a confirmation on every bet is friction most players do
      // not want, and the ones who do will turn it on.
      confirmBets: false,
      setConfirmBets: (confirmBets) => set({ confirmBets }),

      hideInsuranceFor: [],
      setHideInsurance: (tableId, hidden) =>
        set((s) => ({
          hideInsuranceFor: hidden
            ? s.hideInsuranceFor.includes(tableId)
              ? s.hideInsuranceFor
              : [...s.hideInsuranceFor, tableId]
            : s.hideInsuranceFor.filter((id) => id !== tableId),
        })),
    }),
    { name: 'mypoker.tablePrefs', storage: secureStorage },
  ),
);

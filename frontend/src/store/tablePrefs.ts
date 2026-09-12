import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * How THIS DEVICE draws the table — preferences, not account state.
 *
 * Deliberately local rather than in `/me/settings`. None of these changes what
 * the server does, none is visible to another player, and none is worth a round
 * trip mid-hand: a four-colour deck, a default raise size, whether the bet
 * slider asks before committing, and whether the insurance prompt is hidden at
 * a particular table. Game sound is the exception and is NOT here — it lives on
 * the account, so muting follows a player to their other devices.
 *
 * If any of these later need to follow a player across devices they move to
 * `/me/settings`; the shape the UI reads does not change.
 */

/** Pot fractions offered as one-tap raise sizes, after the reference app. */
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

  /**
   * A custom raise size in big blinds, or null to use `defaultRaise`.
   * Never zero — a default raise of nothing is not a bet.
   */
  customRaise: number | null;
  setCustomRaise: (bb: number | null) => void;

  /** Chat and emote sounds, separate from the game's own cues. */
  chatSound: boolean;
  setChatSound: (on: boolean) => void;

  /** Ask before committing a bet dragged on the slider. */
  confirmBets: boolean;
  setConfirmBets: (on: boolean) => void;

  /**
   * Tables whose insurance prompt is hidden, by id.
   *
   * PER TABLE, not global, because that is what the control says — "for this
   * table only". A global flag behind a per-table label would silently suppress
   * a money decision at every other table a player sits at.
   */
  hideInsuranceFor: string[];
  setHideInsurance: (tableId: string, hidden: boolean) => void;
}

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

      // OFF by default: a confirmation step on every bet is friction most
      // players do not want, and the ones who do will turn it on.
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
    { name: 'mypoker.tablePrefs' },
  ),
);

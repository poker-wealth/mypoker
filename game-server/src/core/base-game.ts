import { StateMachine, type StateMachineOptions } from './state-machine';
import { EventBus } from './event-bus';
import type { FinancialCoreClient } from './financial-core-client';

/**
 * BaseGame — the contract every game (Texas, Baccarat, …) implements, and the place the three iron
 * rules (FairPlay §7) are enforced structurally:
 *
 *   #1 Client is read-only.   The only thing a client may read is `getPublicState()`; the only
 *      thing it may send is an action via `handleAction()`, which the SERVER validates and decides.
 *      There is no client-writable state.
 *   #2 State only via StateMachine.  The sole game-phase field lives in `this.sm`; subclasses change
 *      phase exclusively through `this.sm.transition()`.
 *   #3 Money only via the FC API.  Subclasses move funds only through `this.fc` (FinancialCoreClient).
 *      The game server has no database — it cannot write a balance even if it tried.
 */

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActionError';
  }
}

export abstract class BaseGame<
  S extends string,
  Action,
  Events extends Record<string, unknown>,
> {
  protected readonly sm: StateMachine<S>;

  constructor(
    protected readonly roomId: string,
    protected readonly fc: FinancialCoreClient,
    protected readonly events: EventBus<Events>,
    smOptions: StateMachineOptions<S>,
  ) {
    this.sm = new StateMachine(smOptions);
  }

  abstract readonly minPlayers: number;
  abstract readonly maxPlayers: number;

  /** Begin a hand with the seated players. Server-initiated only. */
  abstract start(players: string[]): Promise<void> | void;

  /** A player requests an action; the server validates legality and applies the outcome. */
  abstract handleAction(playerId: string, action: Action): Promise<void> | void;

  /** The read-only view this player is allowed to see (hides opponents' hole cards, etc.). */
  abstract getPublicState(forPlayerId: string): unknown;

  /** Current game phase. */
  get state(): S {
    return this.sm.state;
  }
}

/**
 * StateMachine — a generic finite state machine with a hardcoded transition table.
 *
 * Iron rule #2 (FairPlay §7): all game state changes go ONLY through a StateMachine. Games declare
 * their phases (e.g. WAITING → DEALING → BETTING → SHOWDOWN → SETTLEMENT) and the legal transitions
 * between them; any illegal transition throws rather than silently corrupting game state.
 */

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface StateMachineOptions<S extends string> {
  initial: S;
  /** For each state, the set of states it may transition to. */
  transitions: Readonly<Record<S, readonly S[]>>;
  onEnter?: Partial<Record<S, (from: S) => void>>;
  onExit?: Partial<Record<S, (to: S) => void>>;
}

export class StateMachine<S extends string> {
  private current: S;

  constructor(private readonly opts: StateMachineOptions<S>) {
    this.current = opts.initial;
  }

  get state(): S {
    return this.current;
  }

  is(state: S): boolean {
    return this.current === state;
  }

  /** Whether a transition from the current state to `to` is permitted. */
  can(to: S): boolean {
    return (this.opts.transitions[this.current] ?? []).includes(to);
  }

  /** Perform a transition. Fires onExit(current) then onEnter(next). Throws if not permitted. */
  transition(to: S): void {
    if (!this.can(to)) throw new InvalidTransitionError(this.current, to);
    const from = this.current;
    this.opts.onExit?.[from]?.(to);
    this.current = to;
    this.opts.onEnter?.[to]?.(from);
  }
}

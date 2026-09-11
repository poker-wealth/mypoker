import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * Table sounds, native side. The twin of `frontend/src/lib/sound.ts`, and the
 * call sites read identically: `play('chip')`.
 *
 * WHAT IS DIFFERENT FROM THE WEB, and why this is not a copy of that file:
 *
 *  - There is no AudioContext and no oscillator here, so there is nothing to
 *    synthesise with. A cue therefore either has a recording or it makes no
 *    sound at all — where the web falls back to a tone. `deal`, `turn`,
 *    `check` and `fold` are silent until someone sources files for them, and
 *    that is honest: a cue with no audio is quiet, not broken.
 *  - Nothing has to wait for a gesture. `expo-audio` is not subject to the
 *    browser autoplay rules that shape the web file's whole design.
 *  - Players are created ONCE and replayed by seeking to zero, because
 *    building one per sound leaks native audio handles — at a busy table that
 *    is a handle per chip.
 *
 * Two rules carried over unchanged, because they are product rules rather
 * than platform ones:
 *
 *  1. IT NEVER THROWS. Sound is decoration on a money screen.
 *  2. IT IS OFF UNTIL TOLD OTHERWISE. The player's saved preference arrives
 *     asynchronously and defaulting to ON would make a muted player's first
 *     hand noisy.
 */

export type Cue = 'win' | 'turn' | 'deal' | 'chip' | 'check' | 'fold';

/**
 * The recordings we have. A cue absent from here is silent — deliberately, and
 * visibly, rather than pretending to play something.
 *
 * `require` so Metro bundles the asset; a path that does not exist fails the
 * build rather than going quiet on someone's phone.
 */
const SOURCES: Partial<Record<Cue, number>> = {
  chip: require('../assets/sounds/chips-slide.mp3') as number,
  win: require('../assets/sounds/chips-gather.mp3') as number,
};

/** Levels, matched to the web's. Recordings are mastered loud. */
const VOLUME: Partial<Record<Cue, number>> = { chip: 0.4, win: 0.55 };

const players = new Map<Cue, AudioPlayer>();
let enabled = false;

/**
 * Mirror the player's Settings toggle, exactly as the web does — so flipping
 * the switch takes effect on the next cue rather than the next launch.
 */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/**
 * Play a cue. Silent when muted, when the cue has no recording, or when the
 * platform refuses — never throws.
 */
export function play(cue: Cue): void {
  if (!enabled) return;
  const source = SOURCES[cue];
  if (source === undefined) return;

  try {
    let player = players.get(cue);
    if (!player) {
      player = createAudioPlayer(source);
      player.volume = VOLUME[cue] ?? 0.4;
      players.set(cue, player);
    }
    // Rewind first: a player left at the end of the clip plays nothing, which
    // is how a sound "works once and then stops working".
    player.seekTo(0);
    player.play();
  } catch {
    // Decoration must never surface on a money screen.
  }
}

/**
 * Release the native players.
 *
 * Call when leaving the table: each player holds a native audio handle, and
 * the map deliberately keeps them alive for the whole session otherwise.
 */
export function releaseSounds(): void {
  for (const player of players.values()) {
    try {
      player.remove();
    } catch {
      // Already gone — nothing to do.
    }
  }
  players.clear();
}

/**
 * Table sounds, synthesised.
 *
 * There was no audio in this app at all — and a `sound` toggle in Settings that
 * persisted a preference nothing read. A mute button for silence. This makes it
 * mean something.
 *
 * SYNTHESISED, NOT SAMPLED, on purpose. Every cue here is a few oscillators and
 * an envelope, so there are no audio files to ship, license, or wait on before
 * a win can make a noise. The trade is honest: this sounds clean and functional
 * rather than like real chips on felt. When someone sources proper samples,
 * `play()` is the only thing that has to change — every call site stays put.
 *
 * THREE RULES, all learned from how browsers actually behave:
 *
 * 1. NOTHING HAPPENS BEFORE A GESTURE. Chrome and the Telegram WebView refuse
 *    to start an AudioContext until the user has touched the page, and one
 *    created too early is stuck 'suspended' forever — silent for the whole
 *    session, with no error. So the context is built on the FIRST play and
 *    resumed on every one, which is cheap when it is already running.
 *
 * 2. IT NEVER THROWS. Sound is decoration on a money screen. An unsupported
 *    browser, a denied context, a device with no output — all of it degrades to
 *    silence and none of it reaches a caller.
 *
 * 3. IT IS OFF UNTIL TOLD OTHERWISE. The player's saved preference arrives
 *    asynchronously, and defaulting to ON would make a muted player's first
 *    hand noisy before their settings load.
 */

export type Cue =
  /** The pot arriving at the winner. The one the table is really waiting for. */
  | 'win'
  /** Chips moving — a bet, a call, the sweep into the pot. */
  | 'chip'
  /** A card leaving the deck. */
  | 'deal'
  /** Your turn to act. */
  | 'turn';

let ctx: AudioContext | null = null;
let enabled = false;

/**
 * Mirror the player's Settings toggle. Called from a hook that watches it, so
 * flipping the switch takes effect on the next cue rather than the next reload.
 */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/** The shared context, created on first use — see rule 1. */
function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * One note: an oscillator through its own gain envelope.
 *
 * The envelope is what stops it sounding like a test tone — a near-instant
 * attack and an exponential decay is the difference between a chime and a beep.
 * `exponentialRampToValueAtTime` cannot reach 0, hence the small floor.
 */
function note(
  c: AudioContext,
  opts: {
    freq: number;
    /** Seconds from now. */
    at: number;
    duration: number;
    type: OscillatorType;
    gain: number;
  },
): void {
  const osc = c.createOscillator();
  const amp = c.createGain();
  const start = c.currentTime + opts.at;

  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, start);

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(opts.gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

  osc.connect(amp).connect(c.destination);
  osc.start(start);
  osc.stop(start + opts.duration + 0.02);
}

/** A short burst of filtered noise — chips, cards, anything percussive. */
function noise(
  c: AudioContext,
  opts: { at: number; duration: number; freq: number; q: number; gain: number },
): void {
  const frames = Math.max(1, Math.floor(c.sampleRate * opts.duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Faded across its own length so the burst has a shape rather than a click
    // at each end.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  // Bandpass is what makes it read as "chip" rather than "static".
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = opts.freq;
  band.Q.value = opts.q;

  const amp = c.createGain();
  const start = c.currentTime + opts.at;
  amp.gain.setValueAtTime(opts.gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

  src.connect(band).connect(amp).connect(c.destination);
  src.start(start);
  src.stop(start + opts.duration + 0.02);
}

/**
 * Play a cue. Silent when muted, unsupported, or blocked — never throws.
 *
 * Levels are deliberately low. This plays in a Telegram WebView, often in
 * public, frequently over whatever else the phone is doing.
 */
export function play(cue: Cue): void {
  if (!enabled) return;
  const c = audio();
  if (!c) return;

  try {
    // Cheap no-op when already running; the one thing that un-sticks a context
    // created before the first gesture.
    if (c.state === 'suspended') void c.resume();

    switch (cue) {
      case 'win': {
        // A rising major triad — the only cue allowed to sound like a reward,
        // so it stays reserved for the pot actually arriving.
        const triad = [523.25, 659.25, 783.99]; // C5 E5 G5
        triad.forEach((freq, i) => {
          note(c, { freq, at: i * 0.085, duration: 0.42, type: 'triangle', gain: 0.16 });
        });
        // An octave above the root, under the others, for a bit of sparkle.
        note(c, { freq: 1046.5, at: 0.17, duration: 0.5, type: 'sine', gain: 0.07 });
        break;
      }
      case 'chip':
        noise(c, { at: 0, duration: 0.07, freq: 2600, q: 1.6, gain: 0.11 });
        noise(c, { at: 0.045, duration: 0.06, freq: 3300, q: 2.2, gain: 0.07 });
        break;
      case 'deal':
        noise(c, { at: 0, duration: 0.13, freq: 1300, q: 0.7, gain: 0.075 });
        break;
      case 'turn':
        // Two soft notes, not a buzz: this fires on every one of your turns and
        // anything sharper becomes something players mute the game to escape.
        note(c, { freq: 587.33, at: 0, duration: 0.16, type: 'sine', gain: 0.1 });
        note(c, { freq: 880, at: 0.1, duration: 0.2, type: 'sine', gain: 0.09 });
        break;
    }
  } catch {
    // Rule 2 — decoration must never surface on a money screen.
  }
}

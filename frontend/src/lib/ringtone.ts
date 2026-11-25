/**
 * A reminder chime for follow-up reminders, made with the Web Audio API (no sound file).
 * Pattern: a soft three-note "ding-ding-ding", pause, repeat, until stop().
 *
 * Browsers only allow sound after the user has clicked or tapped the page once. unlockAudio() is called on the
 * first tap anywhere in the app; before that a reminder still shows, silently.
 */
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let master: GainNode | null = null;

const RING_EVERY_MS = 4000; // the chime repeats every 4 seconds until the reminder is closed

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Call from a user gesture (a click or tap) so later rings are allowed to play. */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === "suspended") void c.resume();
}

/** Three rising notes (C6 -> E6 -> G6), 0.18 s apart. */
const NOTES = [1046.5, 1318.5, 1568.0];
const NOTE_GAP = 0.18;
const NOTE_LENGTH = 0.9; // seconds each note takes to fade out

/**
 * One reminder chime: a soft, bell-like "ding-ding-ding". Each note is a sine with a quieter overtone, a quick attack
 * and a long fade, so it sounds like a notification, not a phone call.
 */
function burst(c: AudioContext, out: GainNode) {
  const t0 = c.currentTime + 0.02;
  NOTES.forEach((hz, i) => {
    const start = t0 + i * NOTE_GAP;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_LENGTH);
    gain.connect(out);
    for (const [mult, level] of [[1, 1], [2, 0.25]] as const) { // the note and a soft octave overtone (the "bell")
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.value = hz * mult;
      g.gain.value = level;
      osc.connect(g).connect(gain);
      osc.start(start);
      osc.stop(start + NOTE_LENGTH + 0.05);
    }
  });
}

export function isRinging(): boolean {
  return timer !== null;
}

/** Start ringing (does nothing if already ringing). */
export function startRinging(): void {
  const c = context();
  if (!c || timer) return;
  if (c.state === "suspended") void c.resume();
  master = c.createGain();
  master.gain.value = 1;
  master.connect(c.destination);
  const out = master;
  burst(c, out);
  timer = setInterval(() => burst(c, out), RING_EVERY_MS);
}

/** Stop at once, including a ring already playing. */
export function stopRinging(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.disconnect();
  }
  master = null;
}

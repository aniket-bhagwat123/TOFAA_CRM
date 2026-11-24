/**
 * A phone-style ring for follow-up reminders, made with the Web Audio API (no sound file).
 * Pattern: ring-ring (two short bursts of a 440 + 480 Hz tone), pause, repeat, until stop().
 *
 * Browsers only allow sound after the user has clicked or tapped the page once. unlockAudio() is called on the
 * first tap anywhere in the app; before that a reminder still shows, silently.
 */
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let master: GainNode | null = null;

const RING_EVERY_MS = 3000;

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

/** One "ring-ring": two 0.4 s bursts, 0.2 s apart. */
function burst(c: AudioContext, out: GainNode) {
  const t0 = c.currentTime + 0.02;
  for (const start of [t0, t0 + 0.6]) {
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
    gain.gain.setValueAtTime(0.18, start + 0.38);
    gain.gain.linearRampToValueAtTime(0, start + 0.4);
    gain.connect(out);
    for (const hz of [440, 480]) {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + 0.42);
    }
  }
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

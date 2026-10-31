/**
 * Button sounds + haptics (Johan 31 Oct). Sounds are synthesised with Web Audio (no audio files, no licence
 * questions). To swap a cue for a recorded file later, call setCueFile("alert", "/sounds/x.mp3") or edit CUE_FILES.
 * Vibration uses navigator.vibrate (Android Chrome); iOS Safari has no vibrate, so it is a silent no-op there.
 * Nothing plays before the first user gesture (autoplay rules).
 */
export type Cue = "tap" | "success" | "error" | "alert";
type Tone = { f: number; t: number; d: number; type?: OscillatorType };
/** Synth recipes: frequency (Hz), start offset (s), duration (s). Short and soft. */
export const CUE_TONES: Record<Cue, Tone[]> = {
  tap: [{ f: 880, t: 0, d: 0.035, type: "sine" }],
  success: [{ f: 660, t: 0, d: 0.09 }, { f: 990, t: 0.08, d: 0.14 }],
  error: [{ f: 330, t: 0, d: 0.12, type: "triangle" }, { f: 247, t: 0.11, d: 0.18, type: "triangle" }],
  alert: [{ f: 784, t: 0, d: 0.1 }, { f: 1047, t: 0.12, d: 0.1 }, { f: 784, t: 0.24, d: 0.1 }, { f: 1319, t: 0.36, d: 0.22 }],
};
/** Optional recorded replacements, keyed by cue. Empty = synth. */
export const CUE_FILES: Partial<Record<Cue, string>> = {};
export function setCueFile(c: Cue, url: string | null) { if (url) CUE_FILES[c] = url; else delete CUE_FILES[c]; }
const CUE_GAIN: Record<Cue, number> = { tap: 0.35, success: 0.6, error: 0.6, alert: 1 };
export const VIBE: Record<Cue, number | number[]> = { tap: 12, success: [15, 40, 15], error: [40, 60, 40], alert: [200, 100, 200, 100, 300] };

export type FeedbackPrefs = { buttonSounds: boolean; alertSounds: boolean; vibration: boolean; volume: number };
export const DEFAULT_PREFS: FeedbackPrefs = { buttonSounds: true, alertSounds: true, vibration: true, volume: 0.25 };
const KEY = "fls.feedback.prefs";
const subs = new Set<(p: FeedbackPrefs) => void>();
export function getFeedbackPrefs(): FeedbackPrefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) }; } catch { return { ...DEFAULT_PREFS }; }
}
export function setFeedbackPrefs(p: Partial<FeedbackPrefs>) {
  const n = { ...getFeedbackPrefs(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ }
  subs.forEach((s) => s(n));
}
export function subscribeFeedbackPrefs(s: (p: FeedbackPrefs) => void) { subs.add(s); return () => { subs.delete(s); }; }

let gestured = false;
let ctx: AudioContext | null = null;
export function hasGestured() { return gestured; }
/** For tests. */
export function __resetFeedback(g = false) { gestured = g; ctx = null; }
function audio(): AudioContext | null {
  if (!gestured || typeof window === "undefined") return null;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  try { ctx ||= new AC(); if (ctx!.state === "suspended") void ctx!.resume(); return ctx; } catch { return null; }
}
function synth(c: Cue, vol: number) {
  const a = audio(); if (!a) return;
  const now = a.currentTime;
  for (const tn of CUE_TONES[c]) {
    const o = a.createOscillator(); const g = a.createGain();
    o.type = tn.type || "sine"; o.frequency.value = tn.f;
    const peak = Math.max(0.0001, vol * CUE_GAIN[c] * 0.3);
    g.gain.setValueAtTime(0.0001, now + tn.t);
    g.gain.exponentialRampToValueAtTime(peak, now + tn.t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + tn.t + tn.d);
    o.connect(g); g.connect(a.destination); o.start(now + tn.t); o.stop(now + tn.t + tn.d + 0.02);
  }
}
export function vibrate(c: Cue) {
  if (!getFeedbackPrefs().vibration || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try { return navigator.vibrate(VIBE[c]); } catch { return false; }
}
/** Play a cue (sound + vibration) respecting the user's toggles. Returns what fired, for tests. */
export function feedback(c: Cue, opts: { sound?: boolean; haptic?: boolean } = {}) {
  const p = getFeedbackPrefs();
  const soundOn = opts.sound !== false && (c === "alert" ? p.alertSounds : p.buttonSounds) && gestured;
  const hapticOn = opts.haptic !== false && (c === "alert" || c === "tap" || c === "error") && vibrate(c);
  if (soundOn) {
    const file = CUE_FILES[c];
    if (file) { try { const el = new Audio(file); el.volume = Math.min(1, p.volume * CUE_GAIN[c]); void el.play().catch(() => {}); } catch { /* blocked */ } }
    else synth(c, p.volume);
  }
  return { sound: soundOn, haptic: !!hapticOn };
}

/** Labels that count as primary actions for the tap cue (shared buttons, matched on visible text or data-feedback="tap"). */
export const PRIMARY_RE = /^\s*(accept|send|mark (as )?done|mark complete|complete|save|book|approve|confirm|submit|create|generate)\b/i;
export function isPrimaryAction(el: Element | null): boolean {
  const b = el?.closest?.("button,[role=button],a[data-feedback]") as HTMLElement | null;
  if (!b || (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true") return false;
  const f = b.getAttribute("data-feedback"); if (f === "off") return false; if (f === "tap") return true;
  return PRIMARY_RE.test((b.getAttribute("aria-label") || b.textContent || "").trim());
}
let installed = false;
/** Mount once: unlocks audio on first gesture and adds the tap cue to primary-action buttons app-wide. */
export function installFeedback() {
  if (installed || typeof window === "undefined") return; installed = true;
  const unlock = () => { gestured = true; };
  ["pointerdown", "keydown", "touchstart"].forEach((t) => window.addEventListener(t, unlock, { capture: true, passive: true }));
  window.addEventListener("click", (e) => { if (isPrimaryAction(e.target as Element)) feedback("tap"); }, true);
}
const OK_RE = /(accepted|sent|saved|done|booked|created|approved|paid|complete|success)/i;
/** Toast hook: destructive -> error tone; positive titles -> success chime. */
export function feedbackForToast(t: { variant?: string | null; title?: unknown }) {
  if (t.variant === "destructive") return feedback("error").sound;
  if (typeof t.title === "string" && OK_RE.test(t.title)) return feedback("success").sound;
  return false;
}

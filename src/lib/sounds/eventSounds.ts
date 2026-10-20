/** Dashboard event sounds (Johan 20 Oct). Per-user mute/volume in localStorage; queue with max one sound per 4 s; a burst plays only its highest-value event once. */
export type SoundEvent = "new_lead" | "deal_closed" | "deposit_paid" | "final_payment";
export const SOUND_SRC: Record<SoundEvent, string> = {
  new_lead: "/sounds/new-lead.mp3",
  deal_closed: "/sounds/deal-closed.mp3",
  deposit_paid: "/sounds/deposit-paid.mp3",
  final_payment: "/sounds/final-payment.mp3",
};
/** Higher = more valuable. */
export const SOUND_RANK: Record<SoundEvent, number> = { new_lead: 1, deal_closed: 2, deposit_paid: 3, final_payment: 4 };
const MUTE_KEY = "fls.sounds.muted";
const VOL_KEY = "fls.sounds.volume";
export const GAP_MS = 4000;
const BURST_MS = 600;

type Prefs = { muted: boolean; volume: number };
const listeners = new Set<(p: Prefs) => void>();
export function getSoundPrefs(): Prefs {
  if (typeof window === "undefined") return { muted: false, volume: 0.7 };
  const v = Number(localStorage.getItem(VOL_KEY));
  return { muted: localStorage.getItem(MUTE_KEY) === "1", volume: Number.isFinite(v) && localStorage.getItem(VOL_KEY) !== null ? Math.min(1, Math.max(0, v)) : 0.7 };
}
export function setSoundPrefs(p: Partial<Prefs>) {
  const next = { ...getSoundPrefs(), ...p };
  localStorage.setItem(MUTE_KEY, next.muted ? "1" : "0");
  localStorage.setItem(VOL_KEY, String(next.volume));
  listeners.forEach((l) => l(next));
}
export function subscribeSoundPrefs(l: (p: Prefs) => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** Pure scheduler (testable): collects events, picks the best of a burst, enforces the gap. */
export function createSoundQueue(play: (e: SoundEvent) => void, nowFn: () => number = Date.now, setT: (f: () => void, ms: number) => unknown = setTimeout) {
  let pending: SoundEvent | null = null; let lastPlay = -Infinity; let timer: unknown = null;
  const flush = () => {
    timer = null; if (!pending) return;
    const wait = lastPlay + GAP_MS - nowFn();
    if (wait > 0) { timer = setT(flush, wait); return; }
    const e = pending; pending = null; lastPlay = nowFn(); play(e);
  };
  return {
    push(e: SoundEvent) {
      if (!pending || SOUND_RANK[e] > SOUND_RANK[pending]) pending = e;
      if (!timer) timer = setT(flush, BURST_MS);
    },
  };
}

let unlocked = false;
const cache: Partial<Record<SoundEvent, HTMLAudioElement>> = {};
function el(e: SoundEvent) { return (cache[e] ||= Object.assign(new Audio(SOUND_SRC[e]), { preload: "auto" })); }
/** Browsers block audio until a user gesture; prime the elements on the first click/tap/key. */
export function installAutoplayUnlock() {
  if (typeof window === "undefined" || unlocked) return;
  const go = () => {
    unlocked = true;
    (Object.keys(SOUND_SRC) as SoundEvent[]).forEach((k) => { const a = el(k); a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); });
    ["pointerdown", "keydown", "touchstart"].forEach((t) => window.removeEventListener(t, go, true));
  };
  ["pointerdown", "keydown", "touchstart"].forEach((t) => window.addEventListener(t, go, true));
}
export function playNow(e: SoundEvent, force = false) {
  const p = getSoundPrefs(); if ((p.muted && !force) || typeof window === "undefined") return;
  try { const a = el(e); a.volume = p.volume; a.currentTime = 0; void a.play().catch(() => {}); } catch { /* blocked */ }
}
const queue = typeof window !== "undefined" ? createSoundQueue((e) => playNow(e)) : null;
export function queueSound(e: SoundEvent) { if (!getSoundPrefs().muted) queue?.push(e); }

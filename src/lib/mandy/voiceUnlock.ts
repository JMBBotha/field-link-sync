/**
 * Mandy mobile voice unlock (iPhone Safari + Android Chrome).
 *
 * unlockMandyVoiceFromTap() MUST be called synchronously inside a tap handler,
 * before any await: it sets the audio session, resumes the shared AudioContext,
 * primes one shared <audio> element and speechSynthesis, and starts mic
 * acquisition — all things iOS only allows inside a user gesture.
 */

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

let ctx: AudioContext | null = null;
let sharedEl: HTMLAudioElement | null = null;
let primed = false;
let micStream: MediaStream | null = null;
let micPending: Promise<MediaStream> | null = null;
let current: SharedPlayback | null = null;

export function getMandyAudioContext(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch { return null; }
}

export function getSharedAudio(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (!sharedEl) {
    sharedEl = document.createElement("audio");
    sharedEl.preload = "auto";
    (sharedEl as any).playsInline = true;
    sharedEl.setAttribute("playsinline", "");
  }
  return sharedEl;
}

const micLive = (s: MediaStream | null) => !!s && s.getAudioTracks().some((t) => t.readyState === "live");

function requestMic(): Promise<MediaStream> {
  if (micPending) return micPending;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error("no mic"));
  const p = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).then(
    (s) => { micStream = s; if (micPending === p) micPending = null; return s; },
    (e) => { if (micPending === p) micPending = null; throw e; },
  );
  micPending = p;
  p.catch(() => undefined);
  return p;
}

/** SYNCHRONOUS — call first thing inside the tap handler. */
export function unlockMandyVoiceFromTap(): void {
  try {
    const nav = navigator as any;
    if (nav?.audioSession) nav.audioSession.type = "play-and-record";
  } catch { /* unsupported */ }
  getMandyAudioContext();
  const el = getSharedAudio();
  if (el && !primed) {
    primed = true;
    try {
      el.src = SILENT_WAV;
      const p = el.play();
      const done = () => { if (el.src === SILENT_WAV) { try { el.pause(); } catch { /* ignore */ } } };
      if (p && typeof p.then === "function") p.then(done, done); else done();
    } catch { /* ignore */ }
  }
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch { /* ignore */ }
  if (!micLive(micStream)) void requestMic().catch(() => undefined);
}

/** The mic stream opened in the tap (or a fresh one if it died). */
export async function getMandyMicStream(): Promise<MediaStream> {
  if (micLive(micStream)) return micStream!;
  return requestMic();
}

export function releaseMandyMic(): void {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

export interface SharedPlayback {
  /** true only once audio is REALLY playing ('playing' / currentTime > 0). */
  started: Promise<boolean>;
  ended: Promise<void>;
  cancel: () => void;
}

/** Testable core: play `src` on `el` with real-playback detection. */
/** Mandy talks ~12% faster; pitch preserved. */
export const MANDY_SPEECH_RATE = 1.12;

export function playOnElement(el: HTMLAudioElement, src: string, opts: { startTimeoutMs?: number; maxMs?: number } = {}): SharedPlayback {
  const startTimeoutMs = opts.startTimeoutMs ?? 2500;
  let resolveStarted!: (v: boolean) => void;
  let resolveEnded!: () => void;
  const started = new Promise<boolean>((r) => { resolveStarted = r; });
  const ended = new Promise<void>((r) => { resolveEnded = r; });
  let startedDone = false, endedDone = false;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    el.removeEventListener("playing", onPlaying);
    el.removeEventListener("timeupdate", onTime);
    el.removeEventListener("ended", finish);
    el.removeEventListener("error", onError);
    el.removeEventListener("pause", finish);
    if (startTimer) clearTimeout(startTimer);
    if (capTimer) clearTimeout(capTimer);
  };
  function finish() {
    if (endedDone) return;
    endedDone = true;
    cleanup();
    if (!startedDone) { startedDone = true; resolveStarted(false); }
    if (current === handle) current = null;
    resolveEnded();
  }
  const setStarted = (v: boolean) => {
    if (startedDone || endedDone) return;
    startedDone = true;
    if (startTimer) clearTimeout(startTimer);
    resolveStarted(v);
    if (!v) { finish(); try { el.pause(); } catch { /* ignore */ } return; }
    const d = Number.isFinite(el.duration) && el.duration > 0 ? (el.duration + 1.5) * 1000 : Infinity;
    const cap = Math.min(d, opts.maxMs ?? 60000);
    capTimer = setTimeout(finish, cap);
  };
  function onPlaying() { setStarted(true); }
  function onTime() { if (el.currentTime > 0) setStarted(true); }
  function onError() { setStarted(false); finish(); }

  const handle: SharedPlayback = {
    started, ended,
    cancel: () => { finish(); try { el.pause(); } catch { /* ignore */ } },
  };
  el.addEventListener("playing", onPlaying);
  el.addEventListener("timeupdate", onTime);
  el.addEventListener("ended", finish);
  el.addEventListener("error", onError);
  startTimer = setTimeout(() => setStarted(false), startTimeoutMs);
  try {
    el.src = src;
    // Setting src resets the rate, so apply it after.
    el.defaultPlaybackRate = MANDY_SPEECH_RATE;
    el.playbackRate = MANDY_SPEECH_RATE;
    el.preservesPitch = true;
    (el as any).webkitPreservesPitch = true;
    (el as any).mozPreservesPitch = true;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => setStarted(false));
  } catch { setStarted(false); }
  // Attach pause after play() so a src swap doesn't count as a cancel.
  el.addEventListener("pause", finish);
  return handle;
}

/** Play through the one primed shared element (greeting + replies). */
export function playOnSharedAudio(src: string, opts?: { startTimeoutMs?: number; maxMs?: number }): SharedPlayback {
  stopSharedAudio();
  const el = getSharedAudio();
  if (!el) return { started: Promise.resolve(false), ended: Promise.resolve(), cancel: () => undefined };
  current = playOnElement(el, src, opts);
  return current;
}

export function stopSharedAudio(): void {
  const c = current;
  current = null;
  c?.cancel();
}

/** Safety cap for a speechSynthesis utterance (iOS may never fire onend). */
export const synthSafetyMs = (chars: number) => Math.min(20000, 600 + 70 * chars);

/** Calls onEnd exactly once: onend, onerror or the safety timer, whichever first. */
export function armUtteranceEnd(
  u: { onend: ((...a: any[]) => any) | null; onerror: ((...a: any[]) => any) | null },
  chars: number,
  onEnd: () => void,
): () => void {
  let done = false;
  const fire = () => { if (done) return; done = true; clearTimeout(timer); onEnd(); };
  u.onend = fire;
  u.onerror = fire;
  const timer = setTimeout(fire, synthSafetyMs(chars));
  return fire;
}

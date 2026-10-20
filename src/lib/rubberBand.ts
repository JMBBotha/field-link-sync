/**
 * Soft rubber-band ("bounce") at the top/bottom ends of scroll containers.
 * One document-level manager (mounted once by <RubberBandManager/>), opt-in per container:
 *   [data-scroll-root] mains, [data-bounce] containers, and scrollable Radix dialogs/sheets.
 * - iOS/iPadOS already bounces natively (CSS .scroll-bounce keeps overscroll-behavior auto) -> JS off there.
 * - Mid-list release stops normally (we never touch scrollTop).
 * - Skips: prefers-reduced-motion, [data-no-bounce] subtrees (maps, timelines, drag areas),
 *   inner scrollers that can still scroll, horizontal gestures, multi-touch, form controls.
 * Content is moved with the CSS `translate` property on direct children, so it composes with
 * existing `transform` centering on dialogs/sheets.
 */
const MAX = 72; // px max visual stretch
const RESIST = 0.35;
const SPRING_MS = 250;

const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function scrollableY(el: HTMLElement) {
  const oy = getComputedStyle(el).overflowY;
  return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1;
}

function isBounceContainer(el: HTMLElement) {
  return el.hasAttribute("data-scroll-root") || el.hasAttribute("data-bounce") || !!el.closest("[role=dialog]");
}

/** Nearest vertical scroller from target upward; returns it only if it is an opted-in container. */
export function findBounceTarget(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? (target as HTMLElement) : null;
  while (el && el !== document.body) {
    if (el.hasAttribute("data-no-bounce")) return null;
    if (el.matches("input,textarea,select,[contenteditable=true],.leaflet-container,.mapboxgl-map,.gm-style")) return null;
    if (scrollableY(el)) return isBounceContainer(el) && !el.closest("[data-no-bounce]") ? el : null;
    el = el.parentElement;
  }
  return null;
}

/** Visual offset with resistance; pure for tests. */
export function rubber(delta: number) {
  const s = Math.sign(delta);
  const d = Math.abs(delta) * RESIST;
  return s * MAX * (1 - Math.exp(-d / MAX));
}

function setOffset(el: HTMLElement, y: number, animate: boolean) {
  for (const c of Array.from(el.children) as HTMLElement[]) {
    c.style.transition = animate ? `translate ${SPRING_MS}ms cubic-bezier(.2,.8,.2,1)` : "none";
    c.style.translate = y ? `0 ${y}px` : "";
  }
}

export function installRubberBand(): () => void {
  if (typeof window === "undefined" || isIOS() || reduced()) return () => {};
  let el: HTMLElement | null = null;
  let startY = 0, startX = 0, edge: "top" | "bottom" | null = null, offset = 0, decided = false;

  const atTop = (e: HTMLElement) => e.scrollTop <= 0;
  const atBottom = (e: HTMLElement) => e.scrollTop + e.clientHeight >= e.scrollHeight - 1;
  const release = () => {
    if (el && offset) setOffset(el, 0, true);
    el = null; edge = null; offset = 0; decided = false;
  };

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return release();
    el = findBounceTarget(e.target);
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; decided = false; edge = null; offset = 0;
  };
  const onMove = (e: TouchEvent) => {
    if (!el || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      decided = true;
      if (Math.abs(dx) > Math.abs(dy)) { el = null; return; } // horizontal gesture
    }
    if (!edge) {
      if (dy > 0 && atTop(el)) edge = "top"; else if (dy < 0 && atBottom(el)) edge = "bottom"; else return;
      startY = e.touches[0].clientY;
      return;
    }
    const d = e.touches[0].clientY - startY;
    if ((edge === "top" && d <= 0) || (edge === "bottom" && d >= 0)) { setOffset(el, 0, false); offset = 0; edge = null; return; }
    offset = rubber(d);
    setOffset(el, offset, false);
    if (e.cancelable) e.preventDefault();
  };

  // Wheel / trackpad: small nudge + spring back when pushing past an end.
  let wheelTimer: number | undefined, wheelEl: HTMLElement | null = null, wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const t = findBounceTarget(e.target);
    if (!t) return;
    const pushingTop = e.deltaY < 0 && atTop(t), pushingBottom = e.deltaY > 0 && atBottom(t);
    if (!pushingTop && !pushingBottom) return;
    if (wheelEl && wheelEl !== t) setOffset(wheelEl, 0, true);
    wheelEl = t; wheelAcc -= e.deltaY;
    setOffset(t, rubber(wheelAcc) * 0.6, true);
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => { if (wheelEl) setOffset(wheelEl, 0, true); wheelEl = null; wheelAcc = 0; }, 120);
  };

  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", release, { passive: true });
  document.addEventListener("touchcancel", release, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: true });
  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", release);
    document.removeEventListener("touchcancel", release);
    window.removeEventListener("wheel", onWheel);
  };
}

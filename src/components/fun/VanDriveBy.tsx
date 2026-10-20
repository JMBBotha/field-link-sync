/** Van drive-by (Johan 20 Oct): the 0800-BE-COOL van drives once (right to left, the way the van faces) along the bottom of the screen per browser session. Toggle: Settings > Appearance. Skipped for prefers-reduced-motion. */
import { useEffect, useState } from "react";

export const VAN_PREF_KEY = "fl.vanDriveBy.enabled";
const SESSION_KEY = "fl.vanDriveBy.played";

export function isVanDriveByEnabled(): boolean {
  try { return localStorage.getItem(VAN_PREF_KEY) !== "0"; } catch { return true; }
}
export function setVanDriveByEnabled(on: boolean) {
  try { localStorage.setItem(VAN_PREF_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

/** bottomClass positions the lane: above the phone bottom nav (breakpoint differs per layout), page bottom on desktop. */
export default function VanDriveBy({ bottomClass = "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-2" }: { bottomClass?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const force = new URLSearchParams(window.location.search).has("vandemo");
    try {
      if (!force) {
        if (!isVanDriveByEnabled()) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        if (sessionStorage.getItem(SESSION_KEY)) return;
        sessionStorage.setItem(SESSION_KEY, "1");
      }
    } catch { return; }
    const t = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  // Van photo is 960x368; wheel hubs at x=120 and x=760, y=325, tyre radius 62 (source px). Tyre bottoms are cropped in every source, so round SVG wheels sit on top.
  const H = 60, scale = H / 368, W = Math.round(960 * scale), D = 124 * scale;
  const travel = window.innerWidth + 200; // px over 6 s
  const revSec = (Math.PI * D) / (travel / 6); // roll without slipping
  const wheel = (cx: number) => (
    <svg key={cx} viewBox="-64 -64 128 128" width={D} height={D} className="absolute" style={{ left: cx * scale - D / 2, top: 325 * scale - D / 2, animation: `fl-van-spin ${revSec.toFixed(3)}s linear infinite` }}>
      <circle r="63" fill="#151515" /><circle r="56" fill="none" stroke="#2a2a2a" strokeWidth="3" />
      <circle r="42" fill="#c9ccd1" /><circle r="40" fill="none" stroke="#9aa0a8" strokeWidth="2" />
      {Array.from({ length: 10 }, (_, i) => <rect key={i} x="-3" y="-38" width="6" height="26" rx="2" fill="#8d939b" transform={`rotate(${i * 36})`} />)}
      <circle r="11" fill="#b4b8be" stroke="#7d838b" strokeWidth="2" /><circle r="4" fill="#5d636b" />
    </svg>
  );
  return (
    <div aria-hidden="true" data-testid="van-driveby" className={`pointer-events-none fixed inset-x-0 z-[45] h-[72px] overflow-hidden ${bottomClass}`}>
      <style>{`@keyframes fl-van-drive{from{transform:translateX(calc(100vw + 20px))}to{transform:translateX(-${W + 20}px)}}@keyframes fl-van-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}@keyframes fl-van-spin{to{transform:rotate(-360deg)}}`}</style>
      <div className="absolute left-0 bottom-[6px]" style={{ width: W, height: H, animation: "fl-van-drive 6s linear forwards" }} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setShow(false); }}>
        <img src="/van-driveby.webp" alt="" width={W} height={H} className="absolute inset-0 drop-shadow-md" style={{ width: W, height: H, animation: "fl-van-bob 1.1s ease-in-out infinite" }} />
        {wheel(120)}{wheel(760)}
      </div>
    </div>
  );
}

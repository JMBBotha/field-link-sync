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
  return (
    <div aria-hidden="true" data-testid="van-driveby" className={`pointer-events-none fixed inset-x-0 z-[45] h-16 overflow-hidden ${bottomClass}`}>
      <style>{`@keyframes fl-van-drive{from{transform:translateX(calc(100vw + 20px))}to{transform:translateX(-180px)}}@keyframes fl-van-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}`}</style>
      <div className="absolute bottom-0 left-0" style={{ animation: "fl-van-drive 6s linear forwards" }} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setShow(false); }}>
        <img src="/van-driveby.webp" alt="" width={156} height={60} className="h-[60px] w-auto drop-shadow-md" style={{ animation: "fl-van-bob 0.35s ease-in-out infinite" }} />
      </div>
    </div>
  );
}

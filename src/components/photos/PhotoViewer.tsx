import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/** Shared photo grid classes: phones 2 large squares (~170px at 390), tablet 3, desktop 4 (Johan 31 Oct t2021u). */
export const PHOTO_GRID = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2";

export type ViewerPhoto = { id: string; url?: string | null; caption?: string | null };

/** Full-screen viewer: swipe left/right, pinch or double-tap zoom, close, "n / total" counter and label. */
export function PhotoViewer({ photos, index, onIndex, onClose, label, actions, footer, testId = "photo-viewer" }: {
  photos: ViewerPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  label?: string; actions?: ReactNode; footer?: ReactNode; testId?: string;
}) {
  const n = photos.length; const p = photos[index];
  const [scale, setScale] = useState(1); const [pan, setPan] = useState({ x: 0, y: 0 });
  const g = useRef<{ x: number; y: number; d: number; s: number; px: number; py: number; t: number } | null>(null);
  const go = (d: number) => { if (n < 2) return; onIndex((index + d + n) % n); };
  useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [index]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k); const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; };
  });
  if (!p) return null;
  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onStart = (e: React.TouchEvent) => {
    const t = e.touches; g.current = { x: t[0].clientX, y: t[0].clientY, d: t.length > 1 ? dist(t) : 0, s: scale, px: pan.x, py: pan.y, t: Date.now() };
  };
  const onMove = (e: React.TouchEvent) => {
    const s = g.current; if (!s) return; const t = e.touches;
    if (t.length > 1 && s.d) setScale(Math.min(4, Math.max(1, s.s * dist(t) / s.d)));
    else if (scale > 1) setPan({ x: s.px + t[0].clientX - s.x, y: s.py + t[0].clientY - s.y });
  };
  const onEnd = (e: React.TouchEvent) => {
    const s = g.current; if (!s) return; const c = e.changedTouches[0];
    if (scale <= 1.01 && !s.d && e.touches.length === 0) {
      const dx = c.clientX - s.x, dy = c.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
    }
    if (scale < 1.05) { setScale(1); setPan({ x: 0, y: 0 }); }
    if (e.touches.length === 0) g.current = null;
  };
  const dbl = () => { if (scale > 1) { setScale(1); setPan({ x: 0, y: 0 }); } else setScale(2.5); };
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black text-white" data-testid={testId} role="dialog" aria-modal="true" aria-label={label || "Photo"}>
      <div className="flex items-center gap-2 p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <div className="min-w-0 flex-1 px-1">
          <div className="text-sm font-semibold" data-testid="photo-viewer-counter">{index + 1} / {n}</div>
          {label && <div className="truncate text-xs text-white/70" data-testid="photo-viewer-label">{label}</div>}
        </div>
        {actions}
        <button type="button" onClick={onClose} aria-label="Close" data-testid="photo-viewer-close"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex-1 min-h-0 touch-none select-none overflow-hidden" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onDoubleClick={dbl}>
        {p.url && <img src={p.url} alt={p.caption || label || "Photo"} draggable={false} data-testid="photo-viewer-img"
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain transition-transform duration-75"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }} />}
        {n > 1 && <>
          <button type="button" aria-label="Previous photo" onClick={() => go(-1)} className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 sm:flex"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" aria-label="Next photo" onClick={() => go(1)} className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 sm:flex"><ChevronRight className="h-6 w-6" /></button>
        </>}
      </div>
      {footer ?? (p.caption ? <p className="p-3 text-sm">{p.caption}</p> : null)}
      <div className="pb-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

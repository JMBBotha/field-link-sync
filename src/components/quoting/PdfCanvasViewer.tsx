import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { clampZoom } from "@/lib/priceListPdf";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Load pdf.js lazily with a bundled (same-origin) worker so no browser PDF plugin/iframe is needed. */
async function loadPdfjs() {
  const lib = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

/** Draws every page of a PDF on canvases, fitted to the container width, with zoom. */
export default function PdfCanvasViewer({ data, className = "", testId = "pricelist-canvas" }: { data: ArrayBuffer; className?: string; testId?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false; let loaded: PdfDoc | null = null;
    setDoc(null); setErr(null);
    (async () => {
      try {
        const lib = await loadPdfjs();
        loaded = (await lib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise) as unknown as PdfDoc;
        if (cancelled) { loaded.destroy(); return; }
        setDoc(loaded);
      } catch { if (!cancelled) setErr("Couldn't draw this price list here."); }
    })();
    return () => { cancelled = true; loaded?.destroy().catch(() => {}); };
  }, [data]);

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = pagesRef.current; if (!doc || !host || width < 50) return;
    let cancelled = false; const tasks: { cancel: () => void }[] = [];
    host.innerHTML = "";
    (async () => {
      const target = (width - 16) * zoom; const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n); if (cancelled) return;
        const vp = page.getViewport({ scale: target / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
        canvas.className = "mx-auto mb-2 block bg-white shadow-sm ring-1 ring-slate-200";
        canvas.setAttribute("aria-label", `Page ${n}`);
        host.appendChild(canvas);
        const task = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        tasks.push(task);
        try { await task.promise; } catch { /* cancelled */ }
      }
    })();
    return () => { cancelled = true; tasks.forEach((t) => t.cancel()); };
  }, [doc, width, zoom]);

  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-full bg-white ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40";
  return (
    <div className={`relative flex flex-col rounded-md bg-slate-50 ring-1 ring-slate-200 ${className}`} data-testid={testId}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-2">
        {err ? <p className="p-4 text-sm text-red-600">{err}</p> : !doc ? <p className="p-4 text-sm opacity-70">Opening…</p> : null}
        <div ref={pagesRef} />
      </div>
      {doc && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/90 p-1 shadow ring-1 ring-slate-200">
          <button type="button" className={btn} onClick={() => setZoom((z) => clampZoom(z - 0.25))} disabled={zoom <= 0.5} aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
          <button type="button" className="h-8 min-w-[3rem] rounded-full px-2 text-xs font-medium hover:bg-slate-50" onClick={() => setZoom(1)} aria-label="Fit to width">{Math.round(zoom * 100)}%</button>
          <button type="button" className={btn} onClick={() => setZoom((z) => clampZoom(z + 0.25))} disabled={zoom >= 3} aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Home, Loader2, Mail, MessageCircle, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * In-app quote PDF viewer for phones (Johan 20:18 / 20:51). The PDF is drawn page by page
 * onto canvases with pdf.js (iOS Safari can't show PDFs in an iframe/object), so the user never
 * leaves the app: fixed header (Back, Home) on top, fixed action bar (Back to quote, Save,
 * WhatsApp, Email, Download) at the bottom with safe-area padding, PDF scrolls in between.
 * WhatsApp/Email open the existing Send dialog (confirm/compose step); nothing is sent from here.
 * Download uses the phone's share sheet with the file when available, else a blob download.
 */
export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
}

let _pdfjs: any = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib: any = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerSrc) {
    const w: any = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    lib.GlobalWorkerOptions.workerSrc = w.default;
  }
  _pdfjs = lib;
  return lib;
}

/** Share the file via the phone's share sheet when supported, otherwise a normal blob download. Stays in the app. */
export async function savePdfFile(url: string, fileName: string): Promise<"shared" | "downloaded" | "cancelled"> {
  try {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (nav?.share && nav?.canShare) {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: fileName });
        return "shared";
      }
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return "cancelled";
  }
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  return "downloaded";
}

function PdfPages({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let cancelled = false; let doc: any = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ url }).promise;
        const el = host.current; if (!el || cancelled) return;
        el.innerHTML = "";
        const width = Math.max(280, el.clientWidth - 16);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          c.style.width = `${width}px`; c.style.height = `${Math.floor(vp.height / dpr)}px`;
          c.className = "mx-auto mb-3 block bg-white shadow";
          c.setAttribute("aria-label", `Page ${n}`);
          el.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
          if (n === 1 && !cancelled) setState("ready");
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; try { doc?.destroy(); } catch { /* ignore */ } };
  }, [url]);
  return (
    <>
      {state === "loading" && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading PDF…</div>}
      {state === "error" && <p className="px-6 py-10 text-center text-sm text-slate-600">Couldn't show the PDF here. Use Download below.</p>}
      <div ref={host} data-testid="pdf-viewer-pages" className="px-2 pt-2" />
    </>
  );
}

type Props = {
  url: string;
  fileName: string;
  title: string;
  busySave?: boolean;
  onBack: () => void;
  onSave: () => void;
  onShare: () => void;
};

export default function QuotePdfViewer({ url, fileName, title, busySave, onBack, onSave, onShare }: Props) {
  const navigate = useNavigate();
  const bar = "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold min-h-[52px] active:bg-slate-100";
  return (
    <div data-testid="quote-pdf-viewer" role="dialog" aria-label={`${title} PDF`} className="fixed inset-0 z-[70] bg-slate-200">
      <header className="fixed inset-x-0 top-0 z-[71] flex items-center gap-2 bg-primary px-2 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] text-primary-foreground" style={{ minHeight: "3.5rem" }}>
        <button type="button" onClick={onBack} aria-label="Back to quote" className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
        <button type="button" onClick={() => { onBack(); navigate("/admin"); }} aria-label="Home" data-testid="pdf-viewer-home"
          className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-white/10"><Home className="h-4 w-4" />Home</button>
      </header>
      <main data-testid="pdf-viewer-scroll" className="absolute inset-x-0 overflow-y-auto overscroll-contain"
        style={{ top: "calc(3.5rem + env(safe-area-inset-top))", bottom: "calc(3.75rem + env(safe-area-inset-bottom))", WebkitOverflowScrolling: "touch" }}>
        <PdfPages url={url} />
      </main>
      <nav data-testid="pdf-viewer-actions" className="fixed inset-x-0 bottom-0 z-[71] flex gap-1 border-t border-slate-200 bg-white px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-slate-700 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
        <button type="button" data-no-min className={bar} onClick={onBack}><ArrowLeft className="h-5 w-5" />Back to quote</button>
        <button type="button" data-no-min className={bar} onClick={onSave} disabled={busySave}><Save className="h-5 w-5" />{busySave ? "Saving…" : "Save"}</button>
        <button type="button" data-no-min className={`${bar} text-emerald-700`} onClick={onShare}><MessageCircle className="h-5 w-5" />WhatsApp</button>
        <button type="button" data-no-min className={`${bar} text-sky-700`} onClick={onShare}><Mail className="h-5 w-5" />Email</button>
        <button type="button" data-no-min className={bar} onClick={() => void savePdfFile(url, fileName)}><Download className="h-5 w-5" />Download</button>
      </nav>
    </div>
  );
}

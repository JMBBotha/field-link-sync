import { ArrowLeft, Download, Home, Mail, MessageCircle, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * In-app quote PDF viewer for phones (Johan 20:18). Replaces the bare browser tab a phone
 * opens for a downloaded PDF, so staff always have: Back to quote, Save, WhatsApp, Email,
 * Download, and Home. WhatsApp/Email open the existing Send dialog (the confirm/compose step,
 * with its WhatsApp-to-test-number lock); nothing is sent from here.
 */
export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
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
  const download = () => { const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); };
  const bar = "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold min-h-[52px] active:bg-slate-100";
  return (
    <div data-testid="quote-pdf-viewer" role="dialog" aria-label={`${title} PDF`} className="fixed inset-0 z-[70] flex flex-col bg-slate-100">
      <header className="flex h-14 shrink-0 items-center gap-2 bg-primary px-2 text-primary-foreground">
        <button type="button" onClick={onBack} aria-label="Back to quote" className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
        <button type="button" onClick={() => { onBack(); navigate("/admin"); }} aria-label="Home" data-testid="pdf-viewer-home"
          className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-white/10"><Home className="h-4 w-4" />Home</button>
      </header>
      <div className="min-h-0 flex-1">
        <object data={url} type="application/pdf" className="h-full w-full" aria-label="Quote PDF">
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600">
            <p>This phone can't show the PDF inline.</p>
            <button type="button" onClick={download} className="rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white">Open / download PDF</button>
          </div>
        </object>
      </div>
      <nav data-testid="pdf-viewer-actions" className="sticky bottom-0 flex shrink-0 gap-1 border-t border-slate-200 bg-white px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-slate-700">
        <button type="button" data-no-min className={bar} onClick={onBack}><ArrowLeft className="h-5 w-5" />Back to quote</button>
        <button type="button" data-no-min className={bar} onClick={onSave} disabled={busySave}><Save className="h-5 w-5" />{busySave ? "Saving…" : "Save"}</button>
        <button type="button" data-no-min className={`${bar} text-emerald-700`} onClick={onShare}><MessageCircle className="h-5 w-5" />WhatsApp</button>
        <button type="button" data-no-min className={`${bar} text-sky-700`} onClick={onShare}><Mail className="h-5 w-5" />Email</button>
        <button type="button" data-no-min className={bar} onClick={download}><Download className="h-5 w-5" />Download</button>
      </nav>
    </div>
  );
}

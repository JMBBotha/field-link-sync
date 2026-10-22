import type { ReactNode } from "react";
import { Download, Loader2, Printer, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuoteDocBusy } from "@/hooks/useQuoteDocumentActions";

interface Props {
  busy: QuoteDocBusy;
  onSave: () => void;
  onPdf: () => void;
  onSend: () => void;
  onPrint?: () => void;
  /** Optional left side (e.g. live total on phones). */
  leading?: ReactNode;
  /** Extra buttons after Send (e.g. Convert to Invoice). */
  trailing?: ReactNode;
  className?: string;
  /** Optional Discard (restore the opening snapshot and leave). */
  discard?: () => void;
  /** Phones: one slim row, icon-only secondary buttons. */
  compact?: boolean;
}

/** Shared "Save draft · Download PDF · Send" (+ Print on desktop) bar for the estimate page and Quote Builder. */
export default function QuoteActionBar({ busy, onSave, onPdf, onSend, onPrint, leading, trailing, className = "", discard, compact }: Props) {
  const icon = (key: QuoteDocBusy, Icon: typeof Save) => busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />;
  return (
    <div data-testid="quote-action-bar" className={`flex min-w-0 ${compact ? "flex-nowrap" : "flex-wrap"} items-center justify-end gap-2 print:hidden ${className}`} data-pdf-hide data-html2canvas-ignore>
      {leading && <div className="mr-auto min-w-0">{leading}</div>}
      {discard && <Button type="button" variant="ghost" className={compact ? "h-9 px-2 text-xs" : "h-10 px-3"} onClick={discard} disabled={!!busy} data-testid="qb-discard">Discard</Button>}
      <Button type="button" variant="outline" className={compact ? "h-9 gap-1 px-2.5 text-xs" : "h-10 gap-1.5 px-3"} onClick={onSave} disabled={!!busy} aria-label="Save draft">{icon("save", Save)}{compact ? "Save" : "Save draft"}</Button>
      <Button type="button" variant="outline" className={compact ? "h-9 gap-1 px-2.5 text-xs" : "h-10 gap-1.5 px-3"} onClick={onPdf} disabled={!!busy}>{icon("pdf", Download)}<span className="sm:hidden">PDF</span><span className="hidden sm:inline">Download PDF</span></Button>
      {onPrint && <Button type="button" variant="outline" className="hidden h-10 gap-1.5 px-3 lg:inline-flex" onClick={onPrint} disabled={!!busy}><Printer className="h-4 w-4" />Print</Button>}
      <Button type="button" variant="brand" className={compact ? "h-9 gap-1 px-3 text-xs font-semibold" : "h-10 gap-1.5 px-4 font-semibold"} onClick={onSend} disabled={!!busy}>{icon("send", Send)}Send</Button>
      {trailing}
    </div>
  );
}

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BULK_QUOTE_PDF_CAP } from "@/lib/bulkQuotePdf";

export type QuotePdfProgress = { current: number; total: number };

/**
 * Selection strip on the quotes list. Download builds one combined PDF.
 * The send-together control is passed in so this strip does not own that flow.
 */
export default function QuotePdfSelectionBar({
  selectedCount,
  quoteCount,
  proposalNote,
  bundleBlock,
  busy,
  progress,
  problem,
  onDownload,
  onCancel,
  sendTogether,
}: {
  selectedCount: number;
  quoteCount: number;
  proposalNote?: string | null;
  bundleBlock?: string | null;
  busy: boolean;
  progress: QuotePdfProgress | null;
  problem?: string | null;
  onDownload: () => void;
  onCancel: () => void;
  sendTogether?: ReactNode;
}) {
  const overCap = quoteCount > BULK_QUOTE_PDF_CAP;
  const disabled = busy || quoteCount < 1 || overCap;
  const label = quoteCount >= 1 ? `Download PDF (${quoteCount})` : "Download PDF";
  return (
    <div
      data-testid="quotes-selection-bar"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#3D9BEB] px-3 py-2 text-white"
    >
      <div className="min-w-0">
        <p className="break-words text-sm text-white/90">
          {selectedCount} selected
          {bundleBlock ? ` · ${bundleBlock}` : ""}
          {proposalNote ? ` · ${proposalNote}` : ""}
          {overCap ? ` · Choose ${BULK_QUOTE_PDF_CAP} or fewer quotes` : ""}
        </p>
        {progress && (
          <p data-testid="bulk-pdf-progress" className="text-sm font-semibold text-white">
            Preparing {progress.current} of {progress.total}…
          </p>
        )}
        {problem && (
          <p data-testid="bulk-pdf-problem" className="break-words text-sm font-semibold text-amber-100">
            {problem}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {busy && (
          <Button type="button" variant="outline" size="sm" className="min-h-11" data-testid="bulk-pdf-cancel" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          data-testid="download-quote-pdfs"
          disabled={disabled}
          onClick={onDownload}
          className="min-h-11 shrink-0 bg-[#C2410C] text-white hover:bg-[#9A3412]"
        >
          <Download className="mr-2 h-4 w-4" /> {label}
        </Button>
        {sendTogether}
      </div>
    </div>
  );
}

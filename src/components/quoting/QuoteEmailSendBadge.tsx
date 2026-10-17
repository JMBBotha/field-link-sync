import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuoteEmailSendState, sastTime } from "@/lib/quoteEmailSend";

/**
 * Quote header badge from the server send record (17 Oct 2026):
 * amber "Sending… started HH:MM" while any send of this quote is running (any device/user),
 * red "Not sent: reason" + Retry after a real failure. Nothing when the last send went through.
 */
export default function QuoteEmailSendBadge({ quoteId, onRetry }: { quoteId: string; onRetry?: () => void }) {
  const { data } = useQuoteEmailSendState(quoteId);
  if (data?.active) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" data-testid="quote-send-badge-sending">
        <Loader2 className="h-3 w-3 animate-spin" /> Sending… started {sastTime(data.active.started_at)}
      </span>
    );
  }
  const last = data?.last;
  if (last?.status !== "failed") return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive" title={last.error || undefined} data-testid="quote-send-badge-failed">
      <span className="truncate max-w-[14rem]">Not sent: {last.error || "unknown error"}</span>
      {onRetry && (
        <Button type="button" size="sm" variant="destructive" className="h-5 px-1.5 text-[10px]" onClick={onRetry}>Retry</Button>
      )}
    </span>
  );
}

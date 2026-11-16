import { format } from "date-fns";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Staff banner on an archived lead, quote, client, or invoice. The page still opens. */
export function ArchivedRecordBanner({
  at,
  reason,
  onRestore,
  restoreLabel = "Restore",
  testId = "archived-record-banner",
}: {
  at?: string | null;
  reason?: string | null;
  onRestore?: () => void;
  restoreLabel?: string;
  testId?: string;
}) {
  if (!at && !reason) return null;
  const when = at && !Number.isNaN(new Date(at).getTime()) ? format(new Date(at), "dd MMM yyyy") : at || "";
  return (
    <div role="status" data-testid={testId} className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 print:hidden dark:border-amber-300/40 dark:bg-amber-500/15 dark:text-amber-100">
      <Archive className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        <strong>Archived</strong>{when ? ` ${when}` : ""}
        {reason ? ` · ${reason}` : ""}. Hidden from lists. Staff can still open this page.
      </span>
      {onRestore && (
        <Button size="sm" variant="outline" className="h-7" data-testid={`${testId}-restore`} onClick={onRestore}>
          {restoreLabel}
        </Button>
      )}
    </div>
  );
}

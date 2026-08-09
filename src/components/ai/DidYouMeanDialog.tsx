import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { describeCandidate, type EntityCandidate, type EntityResolution } from "@/lib/entityResolution";
import { CheckCircle2, HelpCircle, RotateCcw } from "lucide-react";

interface DidYouMeanDialogProps {
  resolution: EntityResolution | null;
  onConfirm: (candidate: EntityCandidate) => void;
  onCancel: () => void;
  onRetry: () => void;
}

function confidenceTone(score: number) {
  if (score >= 0.85) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (score >= 0.6) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

const TYPE_LABEL: Record<string, string> = {
  customer: "Customer",
  lead: "Lead",
  job: "Job",
  quote: "Quote",
  product: "Product",
  staff: "Staff",
};

/**
 * Shared "Did you mean…?" pattern for fuzzy matches: lists the top candidates
 * with confidence, and always offers confirm / retry / cancel. Nothing is
 * executed until the user picks.
 */
export function DidYouMeanDialog({
  resolution,
  onConfirm,
  onCancel,
  onRetry,
}: DidYouMeanDialogProps) {
  const open = !!resolution;
  const candidates = resolution?.candidates ?? [];
  const noMatches = candidates.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            {noMatches ? "No close match" : "Did you mean…?"}
          </DialogTitle>
          <DialogDescription>{resolution?.prompt}</DialogDescription>
        </DialogHeader>

        {!noMatches && (
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={`${c.entity_type}-${c.id}`}>
                <button
                  type="button"
                  onClick={() => onConfirm(c)}
                  className={cn(
                    "w-full rounded-lg border border-border bg-card/60 p-3 text-left",
                    "transition-colors hover:border-primary hover:bg-accent",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{c.label}</p>
                      {(c.sublabel || c.reference) && (
                        <p className="truncate text-sm text-muted-foreground">
                          {[c.sublabel, c.reference].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {TYPE_LABEL[c.entity_type] ?? c.entity_type}
                      </Badge>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          confidenceTone(c.score),
                        )}
                      >
                        {Math.round(c.score * 100)}%
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Try again
            </Button>
            {candidates.length > 0 && (
              <Button onClick={() => onConfirm(candidates[0])}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Use top match
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DidYouMeanDialog;

/** Convenience: one-line description used by the voice layer's spoken prompt. */
export { describeCandidate };

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { leadTiming } from "@/lib/leadTiming";

export default function LeadTimingChip({ notes, className }: { notes?: string | null; className?: string }) {
  const t = leadTiming(notes);
  if (!t) return null;
  const asap = /^asap$/i.test(t);
  return (
    <span data-testid="lead-timing" className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
      asap ? "border-orange-300 bg-orange-50 text-orange-800" : "border-sky-300 bg-sky-50 text-sky-800", className)}>
      <Clock className="h-3 w-3" />Timing: {t}
    </span>
  );
}

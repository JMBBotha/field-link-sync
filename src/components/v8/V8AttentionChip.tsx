import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import AttentionStrip from "@/components/jobs/AttentionStrip";
import { useNeedsReschedule } from "@/hooks/useNeedsReschedule";

/** v8 Schedule: all alerts (jobs not moving / missed-job alerts, double bookings, overdue leads) behind one compact chip.
 *  The full AttentionStrip stays mounted (so its queries keep running) and opens in place on click. Nothing removed. */
export default function V8AttentionChip() {
  const [open, setOpen] = useState(false);
  const { data: jobAlerts = [] } = useQuery<any[]>({ queryKey: ["job-alerts"], enabled: false });
  const { data: resched = [] } = useNeedsReschedule();
  const { data: approvals = [] } = useQuery<any[]>({ queryKey: ["invoice-send-approvals"], enabled: false });
  const inv = approvals.filter((a) => a.status === "pending").length;
  const n = jobAlerts.length;
  const r = resched.length;
  return (
    <div className="space-y-2" data-testid="v8-attention">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
          n || r || inv ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : "text-muted-foreground")}>
        <AlertTriangle className="h-3.5 w-3.5" />
        {[inv && `${inv} invoice${inv === 1 ? "" : "s"} to send`, n && `${n} job${n === 1 ? "" : "s"} not moving`, r && `${r} need${r === 1 ? "s" : ""} rescheduling`].filter(Boolean).join(" · ") || "Needs attention"} · {open ? "hide" : "show"}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <div className={open ? undefined : "hidden"}><AttentionStrip /></div>
    </div>
  );
}

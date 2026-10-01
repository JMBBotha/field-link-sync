import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDuration, isCallDump, oneLineSummary, parseCall, type CallLeadLike } from "@/lib/callSummary";

/** One-line call summary (+ area/urgency/next chips) with transcript, recording and call meta behind "Show full call". */
export default function CallSummary({ lead, compact, className }: { lead: CallLeadLike; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const line = oneLineSummary(lead);
  if (!line) return null;
  const p = isCallDump(lead.notes) ? parseCall(lead.notes) : null;
  const chips = [
    lead.call_area && `📍 ${lead.call_area}`,
    lead.call_urgency && lead.call_urgency !== "standard" && `⚡ ${lead.call_urgency.replace("_", " ")}`,
    lead.call_next_action && `→ ${lead.call_next_action}`,
  ].filter(Boolean) as string[];
  const meta = p ? [p.source && `Source: ${p.source}`, p.durationSec != null && `Duration: ${fmtDuration(p.durationSec)}`, p.endedReason && `Ended: ${p.endedReason}`, p.callId && `Call: ${p.callId}`].filter(Boolean) as string[] : [];
  return (
    <div className={cn("min-w-0 w-full space-y-1", className)} onClick={(e) => e.stopPropagation()}>
      <p className={cn("rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100 break-words", compact && "line-clamp-2")}>{line}</p>
      {!compact && chips.length > 0 && (
        <div className="flex flex-wrap gap-1">{chips.map((c) => <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{c}</span>)}</div>
      )}
      {p && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline">
            {open ? "Hide full call" : "Show full call"}<ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="space-y-1.5 rounded-md border bg-muted/30 p-2 text-[11px]">
              {meta.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">{meta.map((m) => <span key={m}>{m}</span>)}</div>}
              {p.recordingUrl && <a href={p.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Recording</a>}
              {p.aiSummary && <p className="italic text-muted-foreground">{p.aiSummary}</p>}
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words">{p.transcript.length ? p.transcript.join("\n") : lead.notes}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

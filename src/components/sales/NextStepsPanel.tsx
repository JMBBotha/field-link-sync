import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useNextSteps } from "@/hooks/useNextSteps";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useNow } from "@/hooks/useLeadSla";
import { RULES, countByRule, minutesWaiting, waitingLabel, urgency, worstUrgency, type NextStep } from "@/lib/nextSteps";

// Calm colours by time urgency (Johan 31 Oct 10:44): soft tint + coloured left edge / dot, never full red blocks.
const CHIP = { green: "border-success/40 bg-success/10 text-success", orange: "border-warning/50 bg-warning/10 text-warning-foreground", red: "border-destructive/40 bg-destructive/10 text-destructive" };
const CARD = { green: "border-l-success bg-success/5", orange: "border-l-warning bg-warning/10", red: "border-l-destructive bg-destructive/5" };
const DOT = { green: "bg-success", orange: "bg-warning", red: "bg-destructive" };
const money = (n: number | null) => (n == null ? "" : `R ${Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ")}`);

function SnoozeDialog({ row, onClose, onSave }: { row: NextStep | null; onClose: () => void; onSave: (o: { until?: Date; dismiss?: boolean; reason: string }) => Promise<void> }) {
  const [days, setDays] = useState<number | "dismiss">(3);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!row) return null;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave(days === "dismiss" ? { dismiss: true, reason } : { until: new Date(Date.now() + days * 86400000), reason });
      setReason(""); onClose();
    } catch (e: any) { setErr(e?.message || "Could not save"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="next-step-snooze">
        <DialogHeader><DialogTitle>Snooze or dismiss</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{row.title} · {row.detail}</p>
        <div className="flex flex-wrap gap-1.5">
          {([1, 3, 7] as const).map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d} day{d > 1 ? "s" : ""}</Button>
          ))}
          <Button size="sm" variant={days === "dismiss" ? "destructive" : "outline"} onClick={() => setDays("dismiss")}>Dismiss</Button>
        </div>
        <Textarea placeholder="Reason (required, kept in the log)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter><Button disabled={busy || !reason.trim()} onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Next steps" to-do panel on top of the Sales / Admin home (Johan 31 Oct 2026). */
export default function NextStepsPanel({ className }: { className?: string }) {
  const { isSalesRep } = useSalesRep();
  const [rep, setRep] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [snoozing, setSnoozing] = useState<NextStep | null>(null);
  const { rows, loading, snooze } = useNextSteps(isSalesRep ? null : rep);
  const now = useNow();
  const owners = useQuery({
    queryKey: ["next-steps-owners"], enabled: !isSalesRep,
    queryFn: async () => {
      const { data } = await (supabase.from("profiles") as any).select("id, full_name").in("dispatch_role", ["sales", "sales_engineer"]);
      return (data || []) as { id: string; full_name: string | null }[];
    },
  });
  if (loading) return null;
  const counts = countByRule(rows);
  const list = filter ? rows.filter((r) => r.rule === filter) : rows;
  const leads = list.filter((r) => r.rule === "new_lead");
  const rest = list.filter((r) => r.rule !== "new_lead");
  const shown = showAll ? rest : rest.slice(0, 6);
  return (
    <section className={cn("v7-solid space-y-2.5 rounded-2xl border bg-card p-3", className)} data-testid="next-steps">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">Next steps</h2>
        <span className="text-sm text-muted-foreground">· {rows.length} open</span>
        {!isSalesRep && (owners.data?.length || 0) > 0 && (
          <select aria-label="Filter by rep" className="ml-auto h-8 rounded-md border bg-background px-2 text-xs" value={rep ?? ""} onChange={(e) => setRep(e.target.value || null)}>
            <option value="">All reps</option>
            {owners.data!.map((o) => <option key={o.id} value={o.id}>{o.full_name || "Rep"}</option>)}
          </select>
        )}
      </div>
      {rows.length === 0 ? <p className="text-sm text-success">All clear. Nothing waiting.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {counts.map(({ rule, n }) => (
            <button key={rule} type="button" onClick={() => setFilter(filter === rule ? null : rule)} aria-pressed={filter === rule}
              className={cn("rounded-full border px-2.5 py-1 text-xs font-bold", CHIP[worstUrgency(rows.filter((r) => r.rule === rule), now)], filter === rule && "ring-2 ring-ring ring-offset-1")}>
              {RULES[rule].chip(n)}
            </button>
          ))}
        </div>
      )}
      {leads.length > 0 && (() => {
        const l = leads[0]; const mins = minutesWaiting(l.since, now);
        return (
          <div className={cn("rounded-xl border border-l-[6px] p-3.5", CARD[urgency(l, now)])} data-testid="next-steps-urgent">
            <div className="flex items-center gap-2 text-base font-bold"><span className={cn("h-2.5 w-2.5 rounded-full", DOT[urgency(l, now)])} />New lead waiting · {waitingLabel(mins)}</div>
            <div className="text-sm text-muted-foreground">{l.detail}{leads.length > 1 ? ` · ${leads.length - 1} more waiting` : ""}</div>
            <div className="mt-2 flex gap-2">
              <Button asChild size="sm"><Link to={l.link}>Open lead</Link></Button>
              {leads.length > 1 && <Button size="sm" variant="outline" onClick={() => setFilter("new_lead")}>View all leads</Button>}
            </div>
          </div>
        );
      })()}
      {shown.length > 0 && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {shown.map((r) => (
            <div key={r.rule + r.entity_id} className={cn("rounded-xl border border-l-[5px] p-3", CARD[urgency(r, now)])} data-testid={`next-step-${r.rule}`}>
              <div className="flex items-center gap-2 font-semibold"><span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[urgency(r, now)])} /><span className="truncate">{r.title}</span></div>
              <div className="text-xs text-muted-foreground">{[r.detail, money(r.amount)].filter(Boolean).join(" · ")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button asChild size="sm"><Link to={r.link}>{RULES[r.rule].action}</Link></Button>
                {r.snoozable && <Button size="sm" variant="outline" onClick={() => setSnoozing(r)}>Snooze</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {rest.length > 6 && <button type="button" className="w-full text-center text-sm font-bold text-primary" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : `Show all ${rest.length}`}</button>}
      <SnoozeDialog row={snoozing} onClose={() => setSnoozing(null)} onSave={(o) => snooze(snoozing!, o)} />
    </section>
  );
}

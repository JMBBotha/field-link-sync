import { useState } from "react";
import { Link } from "react-router-dom";
import NextStepSheet from "@/components/sales/NextStepSheet";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useNextSteps } from "@/hooks/useNextSteps";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useNow } from "@/hooks/useLeadSla";
import { RULES, amountLabel, cardTarget, buttonTarget, countByRule, minutesWaiting, waitingLabel, urgency, worstUrgency, type NextStep } from "@/lib/nextSteps";

// Calm colours by time urgency (Johan 31 Oct 10:44): soft tint + coloured left edge / dot, never full red blocks.
// Readable on dark too (Johan 31 Oct 16:14): light tint text on a dark tint, all >= 4.5:1 (see test).
export const CHIP = {
  green: "border-success/40 bg-success/10 text-[#166534] dark:border-[#16A34A]/60 dark:bg-[#16A34A]/20 dark:text-[#86EFAC]",
  orange: "border-warning/50 bg-warning/10 text-[#9A3412] dark:border-[#EA8C0C]/60 dark:bg-[#EA8C0C]/20 dark:text-[#FDBA74]",
  red: "border-destructive/40 bg-destructive/10 text-[#B91C1C] dark:border-[#DC2626]/60 dark:bg-[#DC2626]/20 dark:text-[#FCA5A5]",
};
const CARD = { green: "border-l-success bg-success/5", orange: "border-l-warning bg-warning/10", red: "border-l-destructive bg-destructive/5" };
export const DOT = { green: "bg-[#22C55E]", orange: "bg-[#F59E0B]", red: "bg-[#EF4444]" };
const money = (n: number | null) => (n == null ? "" : `R ${Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ")}`);

type Cand = { id: string; quote_number: string | null; total: number | null; sent_at: string | null; created_at: string | null; option_group_id: string | null };
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }) : "");

/** Same client's other open quotes, newest first (RLS applies). */
function GroupPicker({ row, onPick, onBack }: { row: NextStep; onPick: (id: string) => Promise<void>; onBack: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mine = new Set((row.options?.length ? row.options : [row]).map((o) => o.entity_id));
  const q = useQuery({
    queryKey: ["group-candidates", row.entity_id],
    queryFn: async (): Promise<Cand[]> => {
      const { data: me } = await (supabase.from("quotes") as any).select("customer_id, lead_id").eq("id", row.entity_id).maybeSingle();
      if (!me || (!me.customer_id && !me.lead_id)) return [];
      let b = (supabase.from("quotes") as any).select("id, quote_number, total, sent_at, created_at, option_group_id")
        .in("status", ["draft", "sent", "viewed"]).is("archived_at", null).order("created_at", { ascending: false }).limit(30);
      b = me.customer_id ? b.eq("customer_id", me.customer_id) : b.eq("lead_id", me.lead_id).is("customer_id", null);
      const { data } = await b;
      return ((data || []) as Cand[]).filter((c) => !mine.has(c.id));
    },
  });
  const pick = async (id: string) => {
    setBusy(id); setErr(null);
    try { await onPick(id); } catch (e: any) { setErr(e?.message || "Could not group"); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-2" data-testid="group-picker">
      <p className="text-sm font-semibold">Group with another quote for this client</p>
      <p className="text-xs text-muted-foreground">Options of the same project show as one follow-up.</p>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !q.data?.length ? <p className="text-sm text-muted-foreground">No other open quotes for this client.</p> : (
        <ul className="divide-y rounded-lg border">
          {q.data.map((c) => (
            <li key={c.id} className="flex items-center gap-2 p-2 text-sm">
              <div className="min-w-0 flex-1"><div className="font-semibold">{c.quote_number || "Quote"}{c.option_group_id ? " · in a group" : ""}</div>
                <div className="text-xs text-muted-foreground">{[money(c.total), c.sent_at ? `sent ${shortDate(c.sent_at)}` : `draft ${shortDate(c.created_at)}`].filter(Boolean).join(" · ")}</div></div>
              <Button size="sm" disabled={!!busy} onClick={() => pick(c.id)}>{busy === c.id ? "…" : "Group"}</Button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
      <Button size="sm" variant="ghost" onClick={onBack}>Back</Button>
    </div>
  );
}

function SnoozeDialog({ row, onClose, onSave, onGroup }: { row: NextStep | null; onClose: () => void; onSave: (o: { until?: Date; dismiss?: boolean; reason: string }) => Promise<void>; onGroup: (other: string) => Promise<void> }) {
  const [grouping, setGrouping] = useState(false);
  const [days, setDays] = useState<number | "dismiss">(3);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!row) return null;
  const close = () => { setGrouping(false); onClose(); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave(days === "dismiss" ? { dismiss: true, reason } : { until: new Date(Date.now() + days * 86400000), reason });
      setReason(""); close();
    } catch (e: any) { setErr(e?.message || "Could not save"); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm" data-testid="next-step-snooze">
        <DialogHeader><DialogTitle>Snooze or dismiss</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{row.title} · {row.detail}</p>
        {row.entity_type === "quote" && (grouping
          ? <GroupPicker row={row} onBack={() => setGrouping(false)} onPick={async (id) => { await onGroup(id); close(); }} />
          : <Button size="sm" variant="outline" className="w-full justify-start" data-testid="group-with" onClick={() => setGrouping(true)}>Group with another quote…</Button>)}
        {!grouping && <>
        <div className="flex flex-wrap gap-1.5">
          {([1, 3, 7] as const).map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d} day{d > 1 ? "s" : ""}</Button>
          ))}
          <Button size="sm" variant={days === "dismiss" ? "destructive" : "outline"} onClick={() => setDays("dismiss")}>Dismiss</Button>
        </div>
        <Textarea placeholder="Reason (required, kept in the log)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter><Button disabled={busy || !reason.trim()} onClick={save}>Save</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}

/** Pop-up for a grouped card: every option with its own Open button, plus Ungroup. */
function GroupSheet({ row, onClose, onUngroup }: { row: NextStep; onClose: () => void; onUngroup: (id: string) => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const un = async (id: string) => { setBusy(id); setErr(null); try { await onUngroup(id); onClose(); } catch (e: any) { setErr(e?.message || "Could not ungroup"); } finally { setBusy(null); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="group-sheet">
        <DialogHeader><DialogTitle>{row.title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{row.options!.length} options for one project. A follow-up on any of them covers all.</p>
        <ul className="divide-y rounded-xl border">
          {row.options!.map((o) => (
            <li key={o.entity_id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
              <div className="min-w-0 flex-1"><div className="font-semibold">{(o.detail || "").split(" · ")[0]}</div>
                <div className="text-xs text-muted-foreground">{[money(o.amount), o.since ? `sent ${shortDate(o.since)}` : ""].filter(Boolean).join(" · ")}</div></div>
              <Button asChild size="sm"><Link to={cardTarget(o)} onClick={onClose}>Open</Link></Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => un(o.entity_id)}>{busy === o.entity_id ? "…" : "Ungroup"}</Button>
            </li>
          ))}
        </ul>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter className="gap-2">
          <Button asChild variant="outline"><Link to={buttonTarget(row)} onClick={onClose}>{RULES[row.rule].action}</Link></Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Next steps" to-do panel on top of the Sales / Admin home (Johan 31 Oct 2026). */
export default function NextStepsPanel({ className }: { className?: string }) {
  const { isSalesRep } = useSalesRep();
  const [openRow, setOpenRow] = useState<NextStep | null>(null);
  const [rep, setRep] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [snoozing, setSnoozing] = useState<NextStep | null>(null);
  const { rows, loading, snooze, groupWith, ungroup } = useNextSteps(isSalesRep ? null : rep);
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
          <div role="button" tabIndex={0} aria-label={`Open lead ${l.title}`} data-href={cardTarget(l)}
            onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a")) setOpenRow(l); }}
            onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpenRow(l); }}
            className={cn("cursor-pointer rounded-xl border border-l-[6px] p-3.5", CARD[urgency(l, now)])} data-testid="next-steps-urgent">
            <div className="flex items-center gap-2 text-base font-bold"><span className={cn("h-[10px] w-[10px] shrink-0 rounded-full", DOT[urgency(l, now)])} />New lead waiting · {waitingLabel(mins)}</div>
            <div className="text-sm text-muted-foreground">{l.detail}{leads.length > 1 ? ` · ${leads.length - 1} more waiting` : ""}</div>
            <div className="mt-2 flex gap-2">
              <Button asChild size="sm"><Link to={buttonTarget(l)}>Open lead</Link></Button>
              {leads.length > 1 && <Button size="sm" variant="outline" onClick={() => setFilter("new_lead")}>View all leads</Button>}
            </div>
          </div>
        );
      })()}
      {shown.length > 0 && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {shown.map((r) => (
            <div key={r.rule + r.entity_id} role="button" tabIndex={0} aria-label={`Show summary for ${r.title}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a")) setOpenRow(r); }}
              onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpenRow(r); }}
              className={cn("cursor-pointer rounded-xl border border-l-[5px] p-3 transition-colors hover:brightness-110 active:opacity-80", CARD[urgency(r, now)])} data-testid={`next-step-${r.rule}`} data-href={cardTarget(r)}>
              <div className="flex items-center gap-2 font-semibold"><span className={cn("h-[10px] w-[10px] shrink-0 rounded-full", DOT[urgency(r, now)])} /><span className="truncate">{r.title}</span></div>
              <div className="text-xs text-muted-foreground">{[r.detail, amountLabel(r, money)].filter(Boolean).join(" · ")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button asChild size="sm"><Link to={buttonTarget(r)}>{RULES[r.rule].action}</Link></Button>
                {r.snoozable && <Button size="sm" variant="outline" onClick={() => setSnoozing(r)}>Snooze</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {rest.length > 6 && <button type="button" className="w-full text-center text-sm font-bold text-primary" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : `Show all ${rest.length}`}</button>}
      {openRow?.options?.length ? <GroupSheet row={openRow} onClose={() => setOpenRow(null)} onUngroup={ungroup} />
        : <NextStepSheet row={openRow} onClose={() => setOpenRow(null)} />}
      <SnoozeDialog row={snoozing} onClose={() => setSnoozing(null)} onSave={(o) => snooze(snoozing!, o)} onGroup={(id) => groupWith(snoozing!.entity_id, id)} />
    </section>
  );
}

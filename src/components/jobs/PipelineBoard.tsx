import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isTestLead } from "@/lib/callSummary";
import { laneOf, LANE_META, type LeadLane } from "@/lib/leadLane";
import { useQuoteStaffActions } from "@/components/quoting/useQuoteStaffActions";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import RowMenu from "@/components/shared/RowMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarPlus, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import {
  STAGES, FLAG_META, buildDeals, columnSummary, followUps, pipelineChips, matchesChip, dropAction, daysSince,
  fmtRand, fmtRandShort, type Deal, type PipelineStage, type PipelineChipKey, type PipeQuote,
} from "@/lib/quotePipeline";

type Q = PipeQuote & {
  company_id: string; quote_number: string | null; customer_name: string | null; accepted_by?: string | null;
  created_by?: string | null; owner_id?: string | null; customers?: { name: string | null; area: string | null; city: string | null } | null;
};
type L = { id: string; customer_name: string | null; customer_address: string | null; primary_intent: string | null; service_type: string | null; created_at: string; first_contact_at: string | null };

const TONE = {
  red: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200",
  orange: "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200",
  yellow: "border-yellow-300 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200",
};
const BAR: Record<PipelineStage, string> = {
  lead: "bg-slate-500", draft: "bg-slate-400", sent: "bg-blue-600", viewed: "bg-violet-600",
  accepted: "bg-emerald-600", booked: "bg-slate-900 dark:bg-slate-200", lost: "bg-slate-300",
};
const nameOf = (q: Q) => q.customers?.name || q.customer_name || "No client";
const initials = (n?: string | null) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
const OPEN_STAGES: PipelineStage[] = ["draft", "sent", "viewed", "accepted"];

/** Shared pipeline data (one fetch for the hub switch summary and the board). RLS scopes reps to their own quotes. */
export function usePipelineData() {
  return useQuery({
    queryKey: ["pipeline"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [quotes, invoices, jobs, leads] = await Promise.all([
        (supabase.from("quotes") as any)
          .select("id, company_id, status, total, created_at, sent_at, viewed_at, accepted_at, accepted_by, declined_at, updated_at, valid_until, lead_id, sales_engineer_id, created_by, owner_id, customer_name, quote_number, customers(name, area, city)")
          .neq("status", "superseded").order("created_at", { ascending: false }).limit(1000),
        supabase.from("invoices").select("quote_id, status, notes, grand_total").not("quote_id", "is", null).limit(2000),
        supabase.from("jobs").select("quote_id, status, created_at").not("quote_id", "is", null).limit(2000),
        (supabase.from("leads") as any)
          .select("id, customer_name, customer_address, primary_intent, service_type, created_at, first_contact_at")
          .eq("status", "pending").is("deleted_at", null).is("merged_into_id", null).order("created_at", { ascending: false }).limit(500),
      ]);
      if (quotes.error) throw quotes.error;
      const qs = (quotes.data || []) as Q[];
      const linkedIds = [...new Set(qs.map((q) => q.lead_id).filter(Boolean))] as string[];
      const repIds = [...new Set(qs.map((q) => q.sales_engineer_id).filter(Boolean))] as string[];
      const [linked, reps] = await Promise.all([
        linkedIds.length ? (supabase.from("leads") as any).select("id, primary_intent, service_type").in("id", linkedIds) : { data: [] },
        repIds.length ? supabase.from("profiles").select("id, full_name").in("id", repIds) : { data: [] },
      ]);
      const laneByLead: Record<string, LeadLane | null> = {};
      ((linked.data || []) as any[]).forEach((l) => { laneByLead[l.id] = laneOf(l); });
      const repName: Record<string, string> = {};
      ((reps.data || []) as any[]).forEach((p) => { repName[p.id] = p.full_name || "Rep"; });
      return { quotes: qs, invoices: invoices.data || [], jobs: jobs.data || [], leads: (leads.data || []) as L[], laneByLead, repName };
    },
  });
}

export const getHideTest = () => (typeof window === "undefined" ? true : localStorage.getItem("fls.pipeline.hideTest") !== "0");

/** Open pipeline value (draft → accepted, not booked), test records hidden per the board setting. */
export function pipelineOpenValue(data: ReturnType<typeof usePipelineData>["data"]) {
  if (!data) return 0;
  const hide = getHideTest();
  return buildDeals(data.quotes.filter((q) => !hide || !isTestLead(nameOf(q))), data.invoices as any, data.jobs as any)
    .filter((d) => OPEN_STAGES.includes(d.stage)).reduce((s, d) => s + d.value, 0);
}

export default function PipelineBoard({ view }: { view: "cards" | "stages" }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { data, isLoading, refetch } = usePipelineData();
  const staff = useQuoteStaffActions(() => { void refetch(); });
  const [rep, setRep] = useState("all");
  const [lane, setLane] = useState<"all" | LeadLane>("all");
  const [hideTest, setHideTestState] = useState(getHideTest());
  const [chip, setChip] = useState<PipelineChipKey | null>(null);
  const [showLost, setShowLost] = useState(false);
  const [bookId, setBookId] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<{ id: string; stage: PipelineStage } | null>(null);
  const [over, setOver] = useState<PipelineStage | null>(null);
  const setHideTest = (v: boolean) => { localStorage.setItem("fls.pipeline.hideTest", v ? "1" : "0"); setHideTestState(v); qc.invalidateQueries({ queryKey: ["pipeline"] }); };

  const now = new Date();
  const { deals, leads, reps, hiddenCount } = useMemo(() => {
    if (!data) return { deals: [] as Deal<Q>[], leads: [] as L[], reps: [] as [string, string][], hiddenCount: 0 };
    const quoted = new Set(data.quotes.map((q) => q.lead_id).filter(Boolean));
    const laneOfQuote = (q: Q): LeadLane => (q.lead_id && data.laneByLead[q.lead_id]) || "sales";
    const keepQ = (q: Q) => (!hideTest || !isTestLead(nameOf(q))) && (rep === "all" || q.sales_engineer_id === (rep === "me" ? user?.id : rep)) && (lane === "all" || laneOfQuote(q) === lane);
    const keepL = (l: L) => (!hideTest || !isTestLead(l.customer_name)) && !quoted.has(l.id) && rep === "all" && (lane === "all" || (laneOf(l) || "sales") === lane);
    const all = buildDeals(data.quotes, data.invoices as any, data.jobs as any, new Date());
    const ds = all.filter((d) => keepQ(d.quote));
    const ls = data.leads.filter(keepL);
    const hidden = hideTest ? data.quotes.filter((q) => isTestLead(nameOf(q))).length + data.leads.filter((l) => isTestLead(l.customer_name)).length : 0;
    const r = Object.entries(data.repName).sort((a, b) => a[1].localeCompare(b[1]));
    return { deals: ds, leads: ls, reps: r, hiddenCount: hidden };
  }, [data, hideTest, rep, lane, user?.id]);

  const notContacted = leads.filter((l) => !l.first_contact_at);
  const chips = pipelineChips(deals, notContacted.length);
  const shownDeals = chip === "not_contacted" ? [] : deals.filter((d) => matchesChip(d, chip));
  const shownLeads = chip && chip !== "not_contacted" ? [] : chip === "not_contacted" ? notContacted : leads;
  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const openValue = openDeals.reduce((s, d) => s + d.value, 0);

  const menuFor = (d: Deal<Q>) => [
    { label: "Open quote", onSelect: () => navigate(`/admin/estimates/${d.quote.id}`) },
    { label: "Edit in builder", onSelect: () => navigate(`/admin/quote-builder?quoteId=${d.quote.id}`) },
    { label: "Book job…", hidden: d.stage !== "accepted", onSelect: () => setBookId(d.quote.id) },
    ...staff.itemsFor(d.quote as any),
  ];

  const runDrop = (id: string, from: PipelineStage, to: PipelineStage) => {
    const d = deals.find((x) => x.quote.id === id);
    if (!d) return;
    const { action, reason } = dropAction(from, to);
    if (!action) { if (reason) toast({ title: reason }); return; }
    if (action === "send") { toast({ title: "Send it from the quote", description: "Opening the quote builder: use Send there." }); navigate(`/admin/quote-builder?quoteId=${id}`); return; }
    if (action === "book") { setBookId(id); return; }
    const item = staff.itemsFor(d.quote as any).find((i) => i.label === (action === "accept" ? "Mark accepted" : "Mark declined"));
    if (!item || item.hidden) { toast({ title: "You can't change this quote", description: "Only the quote's salesperson or an admin can." }); return; }
    item.onSelect();
  };

  const flags = (d: Deal<Q>) => (
    <>
      {d.paid > 0 && <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{fmtRand(d.paid)} PAID</span>}
      {d.partPaid && <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700">PART PAID</span>}
      {d.depositDue && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800">DEPOSIT DUE</span>}
      {d.flags.map((f) => <span key={f} className={cn("rounded border px-1.5 text-[10px] font-bold", TONE[FLAG_META[f].tone])}>{FLAG_META[f].label}</span>)}
    </>
  );

  // Plain render functions (not components) so a card isn't remounted mid-drag.
  const dealCard = (d: Deal<Q>) => {
    const red = d.flags.some((f) => FLAG_META[f].tone === "red");
    return (
      <div
        key={d.quote.id}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.quote.id); setDragFrom({ id: d.quote.id, stage: d.stage }); }}
        onDragEnd={() => { setDragFrom(null); setOver(null); }}
        onClick={() => navigate(`/admin/estimates/${d.quote.id}`)}
        className={cn("cursor-pointer rounded-lg border bg-card p-2.5 text-left shadow-sm transition hover:shadow-md", red && "border-red-300 bg-red-50/40 dark:bg-red-950/20")}
        data-deal-card
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 text-sm font-semibold leading-tight">{nameOf(d.quote)}</div>
          <div className="shrink-0 text-sm font-bold tabular-nums">{fmtRand(d.value)}</div>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {[d.quote.customers?.area || d.quote.customers?.city, d.quote.quote_number || "no number"].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span title={data?.repName[d.quote.sales_engineer_id || ""] || "Rep"} className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[9px] font-bold text-white">
            {initials(data?.repName[d.quote.sales_engineer_id || ""])}
          </span>
          {flags(d)}
          <span className={cn("ml-auto text-[11px] font-semibold tabular-nums", d.days > 7 ? "text-orange-600" : "text-muted-foreground")}>{d.days}d</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {d.stage === "accepted" && (
            <Button size="sm" className="h-7 gap-1 bg-red-600 px-2 text-xs hover:bg-red-700" onClick={() => setBookId(d.quote.id)}>
              <CalendarPlus className="h-3.5 w-3.5" /> Book job
            </Button>
          )}
          <div className="ml-auto"><RowMenu items={menuFor(d)} /></div>
        </div>
      </div>
    );
  };

  const leadCard = (l: L) => {
    const ln = laneOf(l);
    return (
      <div key={l.id} onClick={() => navigate(`/admin/dispatch?lead=${l.id}`)} className={cn("cursor-pointer rounded-lg border bg-card p-2.5 shadow-sm hover:shadow-md", !l.first_contact_at && "border-red-300")}>
        <div className="text-sm font-semibold leading-tight">{l.customer_name || "New lead"}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{(l.customer_address || "Address pending").split(",")[0]}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {ln ? <span className={cn("rounded border px-1.5 text-[10px] font-bold uppercase", LANE_META[ln].className)}>{LANE_META[ln].short}</span>
            : <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800">LANE?</span>}
          {!l.first_contact_at && <span className={cn("rounded border px-1.5 text-[10px] font-bold", TONE.red)}>NOT CONTACTED</span>}
          <span className="ml-auto text-[11px] font-semibold text-red-600">{daysSince(l.created_at, now)}d</span>
        </div>
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => navigate(`/admin/quote-builder?leadId=${l.id}`)}>
            <FileText className="h-3.5 w-3.5" /> Quote
          </Button>
        </div>
      </div>
    );
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading pipeline…</div>;

  return (
    <div className="space-y-3" data-pipeline-board>
      {/* Needs attention (pipeline) — click a chip to filter, again to clear */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 dark:bg-orange-950/10">
        <span className="mr-1 text-xs font-bold tracking-wide text-orange-700 dark:text-orange-300">⚠ NEEDS ATTENTION</span>
        {chips.length === 0 ? <span className="text-xs text-emerald-600">All clear</span> : chips.map((c) => (
          <button key={c.key} onClick={() => setChip(chip === c.key ? null : c.key)}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[c.tone as keyof typeof TONE], chip === c.key && "ring-2 ring-offset-1 ring-slate-700")}>
            <b>{c.n}</b> {c.label}{c.value > 0 && c.key !== "zero" ? ` (${fmtRandShort(c.value)})` : ""}
          </button>
        ))}
      </div>

      {/* Filters + totals */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {reps.length > 1 && (
          <select value={rep} onChange={(e) => setRep(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Rep">
            <option value="all">All reps</option>
            <option value="me">Me</option>
            {reps.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        )}
        <div className="inline-flex rounded-md border p-0.5">
          {(["all", "sales", "service"] as const).map((k) => (
            <button key={k} onClick={() => setLane(k)} className={cn("rounded px-2.5 py-1 text-xs font-medium", lane === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {k === "all" ? "All" : LANE_META[k].label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} /> Hide test records{hideTest && hiddenCount ? ` (${hiddenCount})` : ""}
        </label>
        <div className="ml-auto text-xs text-muted-foreground">
          Open pipeline <b className="text-base text-foreground">{fmtRand(openValue)}</b> · {openDeals.length} quotes · {leads.length} leads
        </div>
      </div>

      {view === "stages" ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STAGES.map((s) => {
            if (s.key === "lost" && !showLost) {
              const n = columnSummary(shownDeals, "lost").count;
              return (
                <button key="lost" onClick={() => setShowLost(true)} onDragOver={(e) => { e.preventDefault(); setOver("lost"); }}
                  onDrop={(e) => { e.preventDefault(); if (dragFrom) runDrop(dragFrom.id, dragFrom.stage, "lost"); setOver(null); }}
                  className={cn("flex w-10 shrink-0 flex-col items-center gap-1 rounded-xl bg-muted/60 py-3 text-xs font-semibold text-muted-foreground", over === "lost" && "ring-2 ring-primary")}>
                  <ChevronLeft className="h-4 w-4" /><span className="[writing-mode:vertical-rl]">Lost · {n}</span>
                </button>
              );
            }
            const sum = s.key === "lead" ? { count: shownLeads.length, total: 0, avgDays: 0 } : columnSummary(shownDeals, s.key);
            const list = shownDeals.filter((d) => d.stage === s.key).sort((a, b) => b.value - a.value);
            return (
              <div key={s.key}
                onDragOver={(e) => { if (dragFrom) { e.preventDefault(); setOver(s.key); } }}
                onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (dragFrom) runDrop(dragFrom.id, dragFrom.stage, s.key); setOver(null); }}
                className={cn("flex w-64 shrink-0 flex-col rounded-xl bg-muted/50", over === s.key && "ring-2 ring-primary")}>
                <div className={cn("h-1.5 rounded-t-xl", BAR[s.key])} />
                <div className="px-3 pb-2 pt-2">
                  <div className="flex items-center justify-between text-sm font-bold">
                    <span>{s.label}</span><span className="text-muted-foreground">{sum.count}</span>
                  </div>
                  <div className="text-lg font-bold tabular-nums">{s.key === "lead" ? "—" : fmtRandShort(sum.total)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.key === "lead" || !sum.count ? s.hint : `${s.hint} · avg ${sum.avgDays} d in stage`}
                  </div>
                  {s.key === "lost" && <button className="mt-1 inline-flex items-center text-[11px] text-primary" onClick={() => setShowLost(false)}>Collapse <ChevronRight className="h-3 w-3" /></button>}
                </div>
                <div className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                  {s.key === "lead" ? shownLeads.map(leadCard) : list.map(dealCard)}
                  {s.key === "booked" && list.length === 0 && (
                    <div className="rounded-lg border border-dashed border-emerald-400 bg-emerald-50/60 p-3 text-center text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
                      Drop an accepted quote here to open <b>Book job</b> (date, tech). The job then appears on Dispatch.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {isAdmin && openDeals.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(openDeals.reduce((m, d) => { const k = data?.repName[d.quote.sales_engineer_id || ""] || "Unassigned"; m[k] = (m[k] || 0) + d.value; return m; }, {} as Record<string, number>))
                .sort((a, b) => b[1] - a[1]).map(([n, v]) => (
                  <span key={n} className="rounded-full border bg-card px-2.5 py-1"><b>{n}</b> {fmtRandShort(v)}</span>
                ))}
            </div>
          )}
          <div className="divide-y rounded-xl border bg-card">
            {followUps(shownDeals).map((d) => (
              <div key={d.quote.id} onClick={() => navigate(`/admin/estimates/${d.quote.id}`)} className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{nameOf(d.quote)} · <span className="tabular-nums">{fmtRand(d.value)}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {STAGES.find((s) => s.key === d.stage)?.label} {d.days} days · {d.quote.quote_number || "no number"} · {data?.repName[d.quote.sales_engineer_id || ""] || "—"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">{flags(d)}</div>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {d.stage === "accepted"
                    ? <Button size="sm" className="h-8 gap-1 bg-red-600 text-xs hover:bg-red-700" onClick={() => setBookId(d.quote.id)}><CalendarPlus className="h-3.5 w-3.5" /> Book job</Button>
                    : <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/admin/estimates/${d.quote.id}`)}>{d.stage === "draft" ? "Finish & send" : "Follow up"}</Button>}
                  <RowMenu items={menuFor(d)} />
                </div>
              </div>
            ))}
            {shownLeads.map((l) => (
              <div key={l.id} onClick={() => navigate(`/admin/dispatch?lead=${l.id}`)} className="flex cursor-pointer items-center gap-2 px-3 py-2.5 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{l.customer_name || "New lead"} · <span className="text-muted-foreground">no quote yet</span></div>
                  <div className="text-xs text-muted-foreground">New lead {daysSince(l.created_at, now)} days{!l.first_contact_at ? " · not contacted" : ""}</div>
                </div>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); navigate(`/admin/quote-builder?leadId=${l.id}`); }}>Quote</Button>
              </div>
            ))}
            {followUps(shownDeals).length === 0 && shownLeads.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Nothing to follow up.</div>}
          </div>
        </div>
      )}

      {staff.dialogs}
      <Dialog open={!!bookId} onOpenChange={(o) => { if (!o) { setBookId(null); void refetch(); qc.invalidateQueries({ queryKey: ["attention-strip"] }); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Book job</DialogTitle></DialogHeader>
          {bookId && <AcceptedWorkSection quoteId={bookId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isTestLead } from "@/lib/callSummary";
import { laneOf, LANE_META, type LeadLane } from "@/lib/leadLane";
import { useQuoteStaffActions } from "@/components/quoting/useQuoteStaffActions";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import QuoteCard from "@/components/cards/QuoteCard";
import LeadCardV2, { type LeadV2 } from "@/components/leads/LeadCardV2";
import AttentionChips from "@/components/jobs/AttentionChips";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText } from "lucide-react";
import {
  STAGES, buildDeals, columnSummary, followUps, pipelineChips, matchesChip, dropAction, daysSince,
  fmtRand, fmtRandShort, type Deal, type PipelineStage, type PipelineChipKey, type PipeQuote,
} from "@/lib/quotePipeline";

type Q = PipeQuote & {
  company_id: string; quote_number: string | null; customer_name: string | null; accepted_by?: string | null;
  created_by?: string | null; owner_id?: string | null; customers?: { name: string | null; area: string | null; city: string | null } | null;
};
type L = LeadV2 & { created_at: string };

const BAR: Record<PipelineStage, string> = {
  lead: "bg-slate-500", draft: "bg-slate-400", sent: "bg-blue-600", viewed: "bg-violet-600",
  accepted: "bg-emerald-600", booked: "bg-slate-900 dark:bg-slate-200", lost: "bg-slate-300",
};
const nameOf = (q: Q) => q.customers?.name || q.customer_name || "No client";
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
          .select("id, customer_name, customer_address, primary_intent, service_type, created_at, first_contact_at, customer_phone, phone, source, notes, status, assigned_agent_id, contact_attempts, stage2_done_at, sla_breached_at, quote_sla_breached_at, call_summary, call_next_action")
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
  const { isSalesRep } = useSalesRep();
  const { data, isLoading, refetch } = usePipelineData();
  const staff = useQuoteStaffActions(() => { void refetch(); });
  const [rep, setRep] = useState("all");
  const [lane, setLane] = useState<"all" | LeadLane>("all");
  const [hideTest, setHideTestState] = useState(getHideTest());
  const [chip, setChip] = useState<PipelineChipKey | null>(null);
  const [showLost, setShowLost] = useState(false);
  const [expanded, setExpanded] = useState<Set<PipelineStage>>(() => new Set());
  const toggleStage = (key: PipelineStage) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [bookId, setBookId] = useState<string | null>(null);
  // Playing-card stacks: New lead behind Draft, Sent behind Viewed. Back card opens on mouse hover or click/tap (pinned).
  const [peekHover, setPeekHover] = useState<PipelineStage | null>(null);
  const [peekPinned, setPeekPinned] = useState<Set<PipelineStage>>(() => new Set());
  const togglePeek = (key: PipelineStage) => setPeekPinned((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
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

  // Render helpers return stable module-level components, never nested component types.
  const dealCard = (d: Deal<Q>, action?: React.ReactNode, draggable = false) => (
    <QuoteCard key={d.quote.id} deal={d} density="full"
      repName={data?.repName[d.quote.sales_engineer_id || ""]} showRep={view !== "stages" && !isSalesRep}
      onOpen={() => navigate(`/admin/estimates/${d.quote.id}`)} onBook={() => setBookId(d.quote.id)}
      menuItems={menuFor(d)} action={action}
      {...(draggable ? {
        draggable: true,
        onDragStart: (e: React.DragEvent<HTMLDivElement>) => { e.dataTransfer.setData("text/plain", d.quote.id); setDragFrom({ id: d.quote.id, stage: d.stage }); },
        onDragEnd: () => { setDragFrom(null); setOver(null); },
      } : {})} />
  );
  const leadCard = (l: L) => (
    <LeadCardV2 key={l.id} density="compact" lead={l}
      onOpen={() => navigate(`/admin/dispatch?lead=${l.id}`)}
      action={<Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
        onClick={() => navigate(`/admin/quote-builder?leadId=${l.id}`)}>
        <FileText className="h-3.5 w-3.5" /> Quote
      </Button>} />
  );

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading pipeline…</div>;

  return (
    <div className="space-y-3" data-pipeline-board>
      {/* Needs attention (pipeline) — click a chip to filter, again to clear */}
      <AttentionChips activeKey={chip} onChipClick={(key) => setChip(chip === key ? null : key)}
        chips={chips.map((c) => ({ ...c, tone: c.tone as "red" | "orange" | "yellow",
          label: c.label + (c.value > 0 && c.key !== "zero" ? ` (${fmtRandShort(c.value)})` : "") }))} />

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
        /* New lead/Draft and Sent/Viewed are playing-card stacks; Accepted and Job booked sit beside them.
           Lost is a narrow rail on the right (xl) or a slim bar (phone/tablet) that slides open on click/tap or drag-over. */
        <div className="flex min-w-0 flex-col gap-3 pb-20 lg:pb-0 xl:flex-row xl:items-start" data-stage-layout>
        <div className="grid min-w-0 flex-1 grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4" data-stage-grid>
          {([["lead", "draft"], ["sent", "viewed"], ["accepted"], ["booked"]] as PipelineStage[][]).map((keys) => {
            const colExpanded = keys.some((k) => expanded.has(k));
            return (
              <div key={keys.join("-")} data-stage-column={keys.join("-")}
                onPointerLeave={(e) => { if (keys.length === 2 && e.pointerType === "mouse") setPeekHover((h) => (h === keys[0] ? null : h)); }}
                className={cn("flex min-w-0 flex-col", keys.length === 2 ? "gap-0" : "gap-3", colExpanded && "col-span-full sm:col-span-2 xl:col-span-4")}>
                {keys.map((key, idx) => {
                  const s = STAGES.find((x) => x.key === key)!;
                  const isBack = keys.length === 2 && idx === 0;
                  const isFront = keys.length === 2 && idx === 1;
                  const sum = s.key === "lead" ? {
                    count: shownLeads.length, total: 0,
                    avgDays: shownLeads.length ? Math.round(shownLeads.reduce((total, l) => total + daysSince(l.created_at, now), 0) / shownLeads.length) : 0,
                  } : columnSummary(shownDeals, s.key);
                  const list = shownDeals.filter((d) => d.stage === s.key).sort((a, b) => b.value - a.value);
                  const isExpanded = expanded.has(s.key);
                  const remaining = sum.count - 2;
                  // Back card is "open" when hovered (mouse), pinned by click/tap, a drag is over it, or fully expanded.
                  const peekOpen = !isBack || isExpanded || peekPinned.has(s.key) || peekHover === s.key || over === s.key;
                  return (
                    <div key={s.key} data-stage-block={s.key}
                      data-card-stack={isBack ? "back" : isFront ? "front" : undefined}
                      data-peek-open={isBack ? (peekOpen ? "true" : "false") : undefined}
                      onPointerEnter={isBack ? (e) => { if (e.pointerType === "mouse") setPeekHover(s.key); } : undefined}
                      onDragOver={(e) => { if (dragFrom) { e.preventDefault(); setOver(s.key); } }}
                      onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
                      onDrop={(e) => { e.preventDefault(); if (dragFrom) runDrop(dragFrom.id, dragFrom.stage, s.key); setOver(null); }}
                      className={cn("flex min-w-0 flex-col rounded-xl bg-muted/50 transition-[margin,box-shadow] duration-300",
                        isBack && "relative z-0 border border-border/60 shadow-sm",
                        isBack && !peekOpen && "mx-2 bg-muted/70",
                        isFront && "relative z-10 border border-border/60 bg-card shadow-[0_-6px_14px_-8px_rgba(0,0,0,0.35)]",
                        isFront && "-mt-3",
                        isExpanded && "col-span-full", over === s.key && "ring-2 ring-primary")}>
                      <div className={cn("h-1.5 rounded-t-xl", BAR[s.key])} />
                      <Button variant="ghost" aria-label={`${s.label} stage`} aria-expanded={isBack ? peekOpen : isExpanded}
                        onClick={() => (isBack ? togglePeek(s.key) : toggleStage(s.key))} className="h-auto w-full flex-col items-stretch whitespace-normal px-3 pb-2 pt-2 text-left">
                        <div className="flex items-center justify-between text-sm font-bold">
                          <span>{s.label}</span><span className="flex items-center gap-2 text-muted-foreground">{sum.count}{(isBack ? peekOpen : isExpanded) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                        </div>
                        <div className="text-lg font-bold tabular-nums">{s.key === "lead" ? "—" : fmtRandShort(sum.total)}</div>
                        <div className={cn("text-[11px] font-normal text-muted-foreground", isBack && !peekOpen && "hidden")}>{s.hint} · avg {sum.avgDays} d in stage</div>
                      </Button>
                      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", peekOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
                        aria-hidden={!peekOpen || undefined} data-peek-body={isBack ? s.key : undefined}
                        {...({ inert: peekOpen ? undefined : "" } as Record<string, unknown>)}>
                      <div className="min-h-0 overflow-hidden">
                      <div className={cn("grid grid-cols-1 gap-2 px-2 pb-2", peekOpen && "min-h-24", isFront && "pb-3", isExpanded && "md:grid-cols-2 lg:grid-cols-3")}>
                        {s.key === "lead"
                          ? (isExpanded ? shownLeads : shownLeads.slice(0, 2)).map(leadCard)
                          : (isExpanded ? list : list.slice(0, 2)).map((d) => dealCard(d, undefined, true))}
                        {!isExpanded && remaining > 0 && <Button variant="ghost" className="h-8 text-xs text-primary" onClick={() => toggleStage(s.key)}>+{remaining} more</Button>}
                        {s.key === "booked" && list.length === 0 && (
                          <div className="rounded-lg border border-dashed border-emerald-400 bg-emerald-50/60 p-3 text-center text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
                            Drop an accepted quote here to open <b>Book job</b> (date, tech). The job then appears on Dispatch.
                          </div>
                        )}
                      </div>
                      </div>
                      </div>
                      {isBack && !peekOpen && <div className="h-3" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {(() => {
          const lostOpen = showLost || over === "lost";
          const lostList = shownDeals.filter((d) => d.stage === "lost").sort((a, b) => b.value - a.value);
          const lostExpanded = expanded.has("lost");
          const lostSum = columnSummary(shownDeals, "lost");
          return (
            <aside data-stage-block="lost" data-lost-open={lostOpen ? "true" : "false"}
              onDragOver={(e) => { if (dragFrom) { e.preventDefault(); setOver("lost"); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === "lost" ? null : o)); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom) runDrop(dragFrom.id, dragFrom.stage, "lost"); setOver(null); }}
              className={cn("flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-muted/50 transition-[width] duration-300 ease-out",
                lostOpen ? "w-full xl:w-72" : "w-full xl:w-11", over === "lost" && "ring-2 ring-primary")}>
              <div className={cn("h-1.5 shrink-0", BAR.lost)} />
              <Button variant="ghost" aria-label="Lost stage" aria-expanded={lostOpen} onClick={() => setShowLost((v) => !v)}
                className={cn("h-auto w-full whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground",
                  lostOpen ? "justify-between" : "justify-between xl:min-h-40 xl:flex-col xl:justify-start xl:gap-2 xl:px-0 xl:py-3")}>
                <span className={cn(!lostOpen && "xl:[writing-mode:vertical-rl] xl:rotate-180")}>Lost · {lostSum.count}</span>
                {lostOpen
                  ? <><span className="xl:hidden"><ChevronUp className="h-4 w-4" /></span><span className="hidden xl:inline"><ChevronRight className="h-4 w-4" /></span></>
                  : <><span className="xl:hidden"><ChevronDown className="h-4 w-4" /></span><span className="hidden xl:inline xl:order-first"><ChevronLeft className="h-4 w-4" /></span></>}
              </Button>
              <div className={cn("min-w-0 xl:min-w-72", !lostOpen && "hidden")} aria-hidden={!lostOpen || undefined} data-lost-body>
                <div className="px-3 pb-1 text-[11px] text-muted-foreground">{fmtRandShort(lostSum.total)} · avg {lostSum.avgDays} d in stage</div>
                <div className="grid grid-cols-1 gap-2 px-2 pb-2 sm:grid-cols-2 xl:grid-cols-1">
                  {(lostExpanded ? lostList : lostList.slice(0, 2)).map((d) => dealCard(d, undefined, true))}
                  {!lostExpanded && lostList.length > 2 && <Button variant="ghost" className="h-8 text-xs text-primary" onClick={() => toggleStage("lost")}>+{lostList.length - 2} more</Button>}
                  {lostList.length === 0 && <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">No lost quotes. Drag a quote here to mark it lost.</div>}
                </div>
              </div>
            </aside>
          );
        })()}
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {followUps(shownDeals).map((d) => dealCard(d, d.stage === "accepted"
              ? <Button size="sm" className="h-8 gap-1 bg-red-600 text-xs hover:bg-red-700" onClick={() => setBookId(d.quote.id)}><CalendarPlus className="h-3.5 w-3.5" /> Book job</Button>
              : <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/admin/estimates/${d.quote.id}`)}>{d.stage === "draft" ? "Finish & send" : "Follow up"}</Button>))}
            {shownLeads.map(leadCard)}
            {followUps(shownDeals).length === 0 && shownLeads.length === 0 && <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Nothing to follow up.</div>}
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

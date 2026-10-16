import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isTestLead } from "@/lib/callSummary";
import { useQuoteStaffActions } from "@/components/quoting/useQuoteStaffActions";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import QuoteCard from "@/components/cards/QuoteCard";
import LeadCardV2 from "@/components/leads/LeadCardV2";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, XCircle } from "lucide-react";
import { buildDeals, fmtRandShort, type Deal } from "@/lib/quotePipeline";
import { V8_COLS, v8ColOf, v8Drop, type V8Col } from "@/lib/v8Flow";
import { usePipelineData, getHideTest, nameOf, type Q, type L } from "@/components/jobs/PipelineBoard";
import "./v8.css";

/** v8 Simple: one Lead → Paid board. Drag uses ONLY the existing transitions (send/accept/book/lose). */
export default function V8PipelineBoard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { isSalesRep } = useSalesRep();
  const ownOnly = isSalesRep && !isAdmin;
  const { data, isLoading, refetch } = usePipelineData();
  const staff = useQuoteStaffActions(() => { void refetch(); });
  const [rep, setRep] = useState("all");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<V8Col | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [showLost, setShowLost] = useState(false);

  const { cols, leads, reps } = useMemo(() => {
    const empty = { cols: {} as Record<V8Col, Deal<Q>[]>, leads: [] as L[], reps: [] as [string, string][] };
    if (!data) return empty;
    const hide = getHideTest();
    const who = ownOnly ? user?.id : rep === "all" ? null : rep;
    const deals = buildDeals(data.quotes.filter((q) => (!hide || !isTestLead(nameOf(q))) && (!who || q.sales_engineer_id === who)), data.invoices as any, data.jobs as any);
    const c = Object.fromEntries([...V8_COLS.map((x) => x.key), "lost"].map((k) => [k, [] as Deal<Q>[]])) as Record<V8Col, Deal<Q>[]>;
    deals.forEach((d) => c[v8ColOf(d, data.invoices as any)].push(d));
    Object.values(c).forEach((l) => l.sort((a, b) => b.value - a.value));
    const quoted = new Set(data.quotes.map((q) => q.lead_id).filter(Boolean));
    const ls = who ? [] : data.leads.filter((l) => !quoted.has(l.id) && (!hide || !isTestLead(l.customer_name)));
    return { cols: c, leads: ls, reps: Object.entries(data.repName).sort((a, b) => a[1].localeCompare(b[1])) };
  }, [data, rep, ownOnly, user?.id]);

  const drop = (to: V8Col) => {
    const all = Object.values(cols).flat();
    const d = all.find((x) => x.quote.id === drag);
    setDrag(null); setOver(null);
    if (!d) return;
    const { action, reason } = v8Drop(d, to);
    if (!action) { if (reason) toast({ title: reason }); return; }
    if (action === "send") { toast({ title: "Send it from the quote", description: "Opening the quote builder: use Send there." }); navigate(`/admin/quote-builder?quoteId=${d.quote.id}`); return; }
    if (action === "book") { setBookId(d.quote.id); return; }
    const item = staff.itemsFor(d.quote as any).find((i) => i.label === (action === "accept" ? "Mark accepted" : "Mark declined"));
    if (!item || item.hidden) { toast({ title: "You can't change this quote", description: "Only the quote's salesperson or an admin can." }); return; }
    item.onSelect();
  };

  const zone = (key: V8Col) => ({
    onDragOver: (e: React.DragEvent) => { if (drag) { e.preventDefault(); setOver(key); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(key); },
  });
  const card = (d: Deal<Q>) => (
    <div key={d.quote.id} className={cn("v8-card", drag === d.quote.id && "is-lifted")} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.quote.id); setDrag(d.quote.id); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}>
      <QuoteCard deal={d} density="full" repName={data?.repName[d.quote.sales_engineer_id || ""]} showRep={!ownOnly}
        onOpen={() => navigate(`/admin/estimates/${d.quote.id}`)} onBook={() => setBookId(d.quote.id)}
        menuItems={[
          { label: "Open quote", onSelect: () => navigate(`/admin/estimates/${d.quote.id}`) },
          { label: "Edit in builder", onSelect: () => navigate(`/admin/quote-builder?quoteId=${d.quote.id}`) },
          { label: "Book job…", hidden: d.stage !== "accepted", onSelect: () => setBookId(d.quote.id) },
          ...staff.itemsFor(d.quote as any),
        ]} />
    </div>
  );

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading pipeline…</div>;
  const total = (k: V8Col) => (cols[k] || []).reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-3" data-testid="v8-pipeline">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="v8-eyebrow">Lead → Quote sent → Accepted → Job booked → Invoiced → Paid</div>
        {!ownOnly && reps.length > 1 && (
          <select value={rep} onChange={(e) => setRep(e.target.value)} className="ml-auto h-8 rounded-md border bg-background px-2 text-sm" aria-label="Person">
            <option value="all">Everyone</option>
            {reps.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        )}
      </div>
      <div className="v8-board flex gap-3 overflow-x-auto pb-24 lg:pb-4 snap-x">
        {V8_COLS.map((c) => {
          const list = c.key === "lead" ? [] : cols[c.key] || [];
          const target = drag && over === c.key;
          return (
            <section key={c.key} {...zone(c.key)} data-v8-col={c.key}
              className={cn("v8-col snap-start", target && "is-over")}>
              <header className="px-3 pt-3 pb-2">
                <div className="flex items-center justify-between text-sm font-bold"><span>{c.label}</span><span className="opacity-60">{c.key === "lead" ? leads.length : list.length}</span></div>
                <div className="text-lg font-bold tabular-nums">{c.key === "lead" ? "—" : fmtRandShort(total(c.key))}</div>
                <div className="text-[11px] opacity-60">{c.hint}</div>
              </header>
              <div className="flex flex-col gap-2 px-2 pb-2">
                {target && <div className="v8-ghost">{c.key === "accepted" ? "Marks accepted" : c.key === "booked" ? "Opens Book job" : c.key === "quote" ? "Opens Send" : "Not a drop step"}</div>}
                {c.key === "lead"
                  ? leads.slice(0, 30).map((l) => (
                    <LeadCardV2 key={l.id} density="compact" lead={l} onOpen={() => navigate(`/admin/dispatch?lead=${l.id}`)}
                      action={<Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => navigate(`/admin/quote-builder?leadId=${l.id}`)}><FileText className="h-3.5 w-3.5" /> Quote</Button>} />))
                  : list.map(card)}
                {c.key !== "lead" && list.length === 0 && !target && <div className="rounded-lg border border-dashed p-3 text-center text-xs opacity-60">Nothing here</div>}
              </div>
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <div {...zone("lost")} className={cn("v8-zone lost", drag && over === "lost" && "is-over")} onClick={() => setShowLost((v) => !v)}>
          <XCircle className="h-4 w-4" /> Lost · {(cols.lost || []).length} {drag ? "— drop to mark lost" : showLost ? "(hide)" : "(show)"}
        </div>
      </div>
      {showLost && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{(cols.lost || []).map(card)}</div>}
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

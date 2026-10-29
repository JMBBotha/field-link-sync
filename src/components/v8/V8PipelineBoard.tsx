import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useSalesRep } from "@/hooks/useSalesRep";
import { PipelineBookings } from "@/components/bookings/Bookings";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isTestLead } from "@/lib/callSummary";
import { laneOf, LANE_META, type LeadLane } from "@/lib/leadLane";
import { useQuoteStaffActions } from "@/components/quoting/useQuoteStaffActions";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import QuoteCard from "@/components/cards/QuoteCard";
import LeadCardV2 from "@/components/leads/LeadCardV2";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, XCircle, PauseCircle } from "lucide-react";
import { useV8Notes } from "./useV8Notes";
import { buildDeals, fmtRandShort, moveBackTarget, NOT_CHOSEN_LABEL, type Deal } from "@/lib/quotePipeline";
import { supabase } from "@/integrations/supabase/client";
import { V8_COLS, v8ColOf, v8Drop, v8CanPark, V8_PARK_FIELD, V8_LOST_FIELD, V8_PARK_REASONS, V8_LOST_REASONS, type V8Col } from "@/lib/v8Flow";
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
  const [lane, setLane] = useState<"all" | LeadLane>("all");
  const [hide, setHideState] = useState(getHideTest());
  const setHide = (v: boolean) => { localStorage.setItem("fls.pipeline.hideTest", v ? "1" : "0"); setHideState(v); };
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<V8Col | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [showLost, setShowLost] = useState(false);
  const [showPark, setShowPark] = useState(false);
  const notes = useV8Notes();
  const [ask, setAsk] = useState<{ kind: "park" | "lost"; d: Deal<Q> } | null>(null);
  const [why, setWhy] = useState(""); const [whyMore, setWhyMore] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [back, setBack] = useState<Q | null>(null); const [backWhy, setBackWhy] = useState(""); const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<Q | null>(null); const [pick, setPick] = useState<Record<string, boolean>>({});
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const { data: r, error } = await (supabase.rpc as any)(fn, args);
      if (error) throw error;
      toast({ title: ok, description: r && (r as any).invoices_voided ? `Unsent invoice voided: ${(r as any).invoices_voided}` : undefined });
      void refetch(); return true;
    } catch (e: any) { toast({ title: "Not changed", description: e.message, variant: "destructive" }); return false; }
    finally { setBusy(false); }
  };
  const doBack = async () => { if (back && await rpc("quote_move_back", { p_quote_id: back.id, p_reason: backWhy.trim() }, "Moved back")) { setBack(null); setBackWhy(""); } };
  const doLink = async () => {
    if (!link) return;
    const ids = [link.id, ...Object.keys(pick).filter((k) => pick[k])];
    if (ids.length < 2) return;
    if (await rpc("link_quote_options", { p_quote_ids: ids, p_labels: {} }, "Linked as options")) { setLink(null); setPick({}); }
  };
  const adminItems = (q: Q) => [
    { label: q.status === "declined" || q.status === "option_not_chosen" ? "Reopen (not lost)…" : "Move back…", hidden: !isAdmin || !moveBackTarget(q as any), onSelect: () => setBack(q) },
    { label: "Link as options…", hidden: !isAdmin || !(q as any).customer_id, onSelect: () => { setLink(q); setPick({}); } },
    { label: "Unlink option", hidden: !isAdmin || !(q as any).option_group_id, onSelect: () => void rpc("unlink_quote_option", { p_quote_id: q.id }, "Unlinked") },
  ];

  const { cols, leads, reps, hiddenN } = useMemo(() => {
    const empty = { hiddenN: 0, cols: {} as Record<V8Col, Deal<Q>[]>, leads: [] as L[], reps: [] as [string, string][] };
    if (!data) return empty;
    const laneQ = (q: Q): LeadLane => ((q.lead_id && (data as any).laneByLead?.[q.lead_id]) || "sales") as LeadLane;
    const who = ownOnly ? user?.id : rep === "all" ? null : rep;
    const deals = buildDeals(data.quotes.filter((q) => (!hide || !isTestLead(nameOf(q))) && (!who || q.sales_engineer_id === who) && (lane === "all" || laneQ(q) === lane)), data.invoices as any, data.jobs as any);
    const c = Object.fromEntries([...V8_COLS.map((x) => x.key), "lost"].map((k) => [k, [] as Deal<Q>[]])) as Record<V8Col, Deal<Q>[]>;
    const pk: Deal<Q>[] = [];
    deals.forEach((d) => { const col = v8ColOf(d, data.invoices as any); if (notes.parked[d.quote.id] && v8CanPark(col)) pk.push(d); else c[col].push(d); });
    (c as any).park = pk;
    Object.values(c).forEach((l) => l.sort((a, b) => b.value - a.value));
    const quoted = new Set(data.quotes.map((q) => q.lead_id).filter(Boolean));
    const ls = who ? [] : data.leads.filter((l) => !quoted.has(l.id) && (!hide || !isTestLead(l.customer_name)) && (lane === "all" || (laneOf(l as any) || "sales") === lane));
    const hiddenN = hide ? data.quotes.filter((q) => isTestLead(nameOf(q))).length + data.leads.filter((l) => isTestLead(l.customer_name)).length : 0;
    return { hiddenN, cols: c, leads: ls, reps: Object.entries(data.repName).sort((a, b) => a[1].localeCompare(b[1])) };
  }, [data, rep, ownOnly, user?.id, notes.parked, lane, hide]);

  const mark = (d: Deal<Q>, label: string) => {
    const item = staff.itemsFor(d.quote as any).find((i) => i.label === label);
    if (!item || item.hidden) { toast({ title: "You can't change this quote", description: "Only the quote's salesperson or an admin can." }); return; }
    item.onSelect();
  };
  const unpark = async (d: Deal<Q>) => {
    try { await notes.write(d.quote as any, V8_PARK_FIELD, null); toast({ title: "Back on the board" }); }
    catch (e: any) { toast({ title: "Could not un-park", description: e.message, variant: "destructive" }); }
  };
  const confirmAsk = async () => {
    if (!ask) return;
    const text = [why, whyMore.trim()].filter(Boolean).join(": ") || "No reason given";
    const a = ask; setAsk(null); setWhy(""); setWhyMore("");
    try {
      await notes.write(a.d.quote as any, a.kind === "park" ? V8_PARK_FIELD : V8_LOST_FIELD, text);
      if (a.kind === "lost") mark(a.d, "Mark declined"); else toast({ title: "Parked", description: text });
    } catch (e: any) { toast({ title: "Could not save the reason", description: e.message, variant: "destructive" }); }
  };
  const drop = (to: V8Col | "park") => {
    const all = Object.values(cols).flat();
    const d = all.find((x) => x.quote.id === drag);
    setDrag(null); setOver(null);
    if (!d) return;
    if (to === "park") {
      const col = v8ColOf(d, (data?.invoices || []) as any);
      if (notes.parked[d.quote.id]) return;
      if (!v8CanPark(col)) { toast({ title: "Only open quotes (sent or accepted) can be parked." }); return; }
      setAsk({ kind: "park", d }); return;
    }
    if (to === "lost" && v8Drop(d, to).action === "lose") { setAsk({ kind: "lost", d }); return; }
    const { action, reason } = v8Drop(d, to);
    if (!action) { if (reason) toast({ title: reason }); return; }
    if (action === "send") { toast({ title: "Send it from the quote", description: "Opening the quote builder: use Send there." }); navigate(`/admin/quote-builder?quoteId=${d.quote.id}`); return; }
    if (action === "book") { setBookId(d.quote.id); return; }
    mark(d, action === "accept" ? "Mark accepted" : "Mark declined");
  };

  const zone = (key: V8Col | "park") => ({
    onDragOver: (e: React.DragEvent) => { if (drag) { e.preventDefault(); setOver(key as any); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === (key as any) ? null : o)); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(key); },
  });
  const card = (d: Deal<Q>) => (
    <div key={d.quote.id} className={cn("v8-card", drag === d.quote.id && "is-lifted")} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.quote.id); setDrag(d.quote.id); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}>
      {(notes.parked[d.quote.id] || (d.stage === "lost" && notes.lost[d.quote.id])) && (
        <div className={cn("v8-note", d.stage === "lost" ? "lost" : "park")}>{d.stage === "lost" ? "Lost: " : "Parked: "}{d.stage === "lost" ? notes.lost[d.quote.id] : notes.parked[d.quote.id]}</div>
      )}
      <QuoteCard deal={d} density="full" repName={data?.repName[d.quote.sales_engineer_id || ""]} showRep={!ownOnly}
        onOpen={() => navigate(`/admin/estimates/${d.quote.id}`)} onBook={() => setBookId(d.quote.id)}
        menuItems={[
          { label: "Open quote", onSelect: () => navigate(`/admin/estimates/${d.quote.id}`) },
          { label: "Edit in builder", onSelect: () => navigate(`/admin/quote-builder?quoteId=${d.quote.id}`) },
          { label: "Book job…", hidden: d.stage !== "accepted", onSelect: () => setBookId(d.quote.id) },
          { label: notes.parked[d.quote.id] ? "Un-park" : "Park…", hidden: !notes.parked[d.quote.id] && !v8CanPark(v8ColOf(d, (data?.invoices || []) as any)),
            onSelect: () => (notes.parked[d.quote.id] ? void unpark(d) : setAsk({ kind: "park", d })) },
          ...staff.itemsFor(d.quote as any),
          ...adminItems(d.quote),
        ]} />
      {d.options && (
        <div className="v8-options mt-1 rounded-md border border-dashed px-2 py-1 text-xs" data-testid="v8-options">
          <button className="w-full text-left font-medium opacity-80" onClick={() => setOpen((o) => ({ ...o, [d.quote.id]: !o[d.quote.id] }))}>
            {open[d.quote.id] ? "▾" : "▸"} {d.options.length} options
          </button>
          {open[d.quote.id] && d.options.map((o) => (
            <div key={o.quote.id} className="flex items-center justify-between gap-2 py-0.5">
              <button className="truncate text-left hover:underline" onClick={() => navigate(`/admin/estimates/${o.quote.id}`)}>
                {(o.quote as any).option_label || o.quote.quote_number} · {fmtRandShort(o.value)}
              </button>
              {o.stage === "not_chosen"
                ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{NOT_CHOSEN_LABEL}</span>
                : <span className="shrink-0 opacity-60">{o.quote.id === d.quote.id ? "shown" : o.stage}</span>}
              {isAdmin && moveBackTarget(o.quote as any) && o.quote.id !== d.quote.id && (
                <button className="shrink-0 underline opacity-70" onClick={() => setBack(o.quote)}>{o.stage === "not_chosen" ? "Reopen" : "Move back"}</button>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading pipeline…</div>;
  const total = (k: V8Col) => (cols[k] || []).reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-3" data-testid="v8-pipeline">
      <PipelineBookings ownOnly={ownOnly} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="v8-eyebrow">Lead → Quote sent → Accepted → Job booked → Invoiced → Paid</div>
        <div className="ml-auto inline-flex rounded-md border p-0.5" role="group" aria-label="Lane" data-testid="v8-lane">
          {(["all", "sales", "service"] as const).map((k) => (
            <button key={k} onClick={() => setLane(k)} className={"rounded px-2.5 py-1 text-xs font-medium " + (lane === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{k === "all" ? "All" : LANE_META[k].label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide test records{hide && hiddenN ? ` (${hiddenN})` : ""}</label>
        {!ownOnly && reps.length > 1 && (
          <select value={rep} onChange={(e) => setRep(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Person">
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
                <div className="text-xs opacity-60">{c.hint}</div>
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
        <div {...zone("park")} className={cn("v8-zone park", drag && over === ("park" as any) && "is-over")} onClick={() => setShowPark((v) => !v)} data-testid="v8-park">
          <PauseCircle className="h-4 w-4" /> Park · {((cols as any).park || []).length} {drag ? "— drop to park (waiting for stock / no answer)" : showPark ? "(hide)" : "(show)"}
        </div>
      </div>
      {showPark && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{((cols as any).park || []).map(card)}</div>}
      {showLost && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{(cols.lost || []).map(card)}</div>}
      {staff.dialogs}
      <Dialog open={!!ask} onOpenChange={(o) => { if (!o) { setAsk(null); setWhy(""); setWhyMore(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{ask?.kind === "park" ? "Park this deal" : "Why was it lost?"}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-2">
            {(ask?.kind === "park" ? V8_PARK_REASONS : V8_LOST_REASONS).map((r) => (
              <Button key={r} size="sm" variant={why === r ? "default" : "outline"} onClick={() => setWhy(r)}>{r}</Button>))}
          </div>
          <input value={whyMore} onChange={(e) => setWhyMore(e.target.value)} placeholder="Note (optional)" className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
          <div className="text-xs text-muted-foreground">{ask?.kind === "park" ? "Parking doesn't change the quote's status. Un-park it from the card menu." : "Next you confirm Mark declined, the same as before."}</div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
            <Button onClick={() => void confirmAsk()} disabled={!why}>{ask?.kind === "park" ? "Park" : "Continue"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!back} onOpenChange={(o) => { if (!o) { setBack(null); setBackWhy(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Move {back?.quote_number} back to {back ? moveBackTarget(back as any) : ""}?</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">{back ? nameOf(back) : ""}. Any unsent deposit invoice from the accept is voided and its email held. Blocked if a payment or a booked job exists.</div>
          <input value={backWhy} onChange={(e) => setBackWhy(e.target.value)} placeholder="Reason (required)" className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBack(null)}>Cancel</Button>
            <Button onClick={() => void doBack()} disabled={busy || backWhy.trim().length < 3}>Move back</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!link} onOpenChange={(o) => { if (!o) { setLink(null); setPick({}); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Link as options</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">Alternatives for {link ? nameOf(link) : ""}. When the client accepts one, the others show as "{NOT_CHOSEN_LABEL}", not lost.</div>
          <div className="max-h-60 space-y-1 overflow-y-auto text-sm">
            {(data?.quotes || []).filter((q) => link && q.id !== link.id && (q as any).customer_id === (link as any).customer_id).map((q) => (
              <label key={q.id} className="flex items-center gap-2"><input type="checkbox" checked={!!pick[q.id]} onChange={(e) => setPick((p) => ({ ...p, [q.id]: e.target.checked }))} />{q.quote_number} · {q.status} · {fmtRandShort(Number(q.total) || 0)}</label>))}
            {link && !(data?.quotes || []).some((q) => q.id !== link.id && (q as any).customer_id === (link as any).customer_id) && <div className="opacity-60">No other quotes for this client.</div>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setLink(null)}>Cancel</Button>
            <Button onClick={() => void doLink()} disabled={busy || !Object.values(pick).some(Boolean)}>Link</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!bookId} onOpenChange={(o) => { if (!o) { setBookId(null); void refetch(); qc.invalidateQueries({ queryKey: ["attention-strip"] }); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Book job</DialogTitle></DialogHeader>
          {bookId && <AcceptedWorkSection quoteId={bookId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

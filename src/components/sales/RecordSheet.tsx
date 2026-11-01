import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { MarkSentManuallyButton, channelLabel } from "@/components/documents/MarkSentManually";
import { shortDescription, type NextStep, type NextStepRule } from "@/lib/nextSteps";
import { SnoozeDialog } from "@/components/sales/NextStepsPanel";

/** One pop-up for a quote or invoice (Johan t2038u-t2040u): summary, a status timeline from real fields only, and every action. */
export type RecordRef = {
  kind: "quote" | "invoice"; id: string; title: string;
  /** The card's own next action (Send quote, Follow up, Take deposit…), unchanged. */
  primary?: { label: string; to: string } | null;
  /** next_step_snoozes.rule used when snoozing from here. */
  snoozeRule?: NextStepRule | null;
};

const R = (n: number | null | undefined) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const DT = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }) : null);

type Inv = { id: string; invoice_number: string | null; status: string | null; grand_total: number | null; paid_date: string | null; created_at: string | null; sent_at: string | null; sent_channel: string | null; sent_method: string | null; notes?: string | null };
export type RecordData = {
  kind: "quote" | "invoice"; id: string; number: string | null; client: string | null; total: number | null; status: string | null; created_at: string | null;
  sent_at: string | null; sent_channel: string | null; sent_method: string | null; viewed_at?: string | null; accepted_at?: string | null; declined_at?: string | null;
  rooms?: string; has_token?: boolean; invoices: (Inv & { paid: number | null })[];
};

async function paidByInvoice(ids: string[]): Promise<Map<string, number> | null> {
  if (!ids.length) return new Map();
  const { data, error } = await (supabase.from("payments") as any).select("invoice_id, amount, status").in("invoice_id", ids);
  if (error) return null; // not readable for this login: show status only
  const m = new Map<string, number>();
  (data || []).filter((p: any) => p.status === "paid").forEach((p: any) => m.set(p.invoice_id, (m.get(p.invoice_id) || 0) + Number(p.amount || 0)));
  return m;
}

export async function loadRecord(ref: Pick<RecordRef, "kind" | "id">): Promise<RecordData | null> {
  const IC = "id, invoice_number, status, grand_total, paid_date, created_at, sent_at, sent_channel, sent_method, notes";
  if (ref.kind === "quote") {
    const [q, a, i, inv] = await Promise.all([
      (supabase.from("quotes") as any).select("id, quote_number, customer_name, total, status, created_at, sent_at, sent_channel, sent_method, viewed_at, accepted_at, declined_at, public_token").eq("id", ref.id).maybeSingle(),
      (supabase.from("quote_areas") as any).select("name, sort_order").eq("quote_id", ref.id).order("sort_order", { nullsFirst: false }),
      (supabase.from("quote_items") as any).select("item_name, sort_order").eq("quote_id", ref.id).is("parent_item_id", null).order("sort_order").limit(6),
      (supabase.from("invoices") as any).select(IC).eq("quote_id", ref.id).neq("status", "void").order("created_at"),
    ]);
    if (!q.data) return null;
    const invs = (inv.data || []) as Inv[]; const paid = await paidByInvoice(invs.map((x) => x.id));
    return { kind: "quote", id: q.data.id, number: q.data.quote_number, client: q.data.customer_name, total: q.data.total, status: q.data.status, created_at: q.data.created_at,
      sent_at: q.data.sent_at, sent_channel: q.data.sent_channel, sent_method: q.data.sent_method, viewed_at: q.data.viewed_at, accepted_at: q.data.accepted_at, declined_at: q.data.declined_at,
      has_token: !!q.data.public_token, rooms: shortDescription((a.data || []).map((x: any) => x.name), (i.data || []).map((x: any) => x.item_name)),
      invoices: invs.map((x) => ({ ...x, paid: paid ? paid.get(x.id) ?? 0 : null })) };
  }
  const { data } = await (supabase.from("invoices") as any).select(IC + ", customer_name").eq("id", ref.id).maybeSingle();
  if (!data) return null;
  const paid = await paidByInvoice([data.id]);
  return { kind: "invoice", id: data.id, number: data.invoice_number, client: data.customer_name, total: data.grand_total, status: data.status, created_at: data.created_at,
    sent_at: data.sent_at, sent_channel: data.sent_channel, sent_method: data.sent_method, invoices: [{ ...data, paid: paid ? paid.get(data.id) ?? 0 : null }] };
}

type Step = { k: string; label: string; when: string | null; empty?: string; tone?: "done" | "bad" | "wait" };
/** Timeline rows from real columns only. Quotes keep one viewed_at (first client open); there is no last-viewed field. */
export function timelineSteps(d: RecordData): Step[] {
  const sentHow = d.sent_method === "manual" ? `Sent · marked by staff · ${channelLabel(d.sent_channel)}` : d.sent_channel ? `Sent · ${channelLabel(d.sent_channel)}` : "Sent";
  const s: Step[] = [{ k: "created", label: "Created", when: DT(d.created_at), tone: "done" },
    { k: "sent", label: d.sent_at ? sentHow : "Sent", when: DT(d.sent_at), empty: "Not sent", tone: d.sent_at ? "done" : "wait" }];
  if (d.kind === "quote") {
    s.push({ k: "viewed", label: "Viewed by client (first open)", when: DT(d.viewed_at), empty: d.sent_at ? "Not viewed yet" : "Not viewed yet", tone: d.viewed_at ? "done" : "wait" });
    if (d.declined_at || d.status === "declined") s.push({ k: "declined", label: "Declined", when: DT(d.declined_at), empty: "Declined (no date)", tone: "bad" });
    else s.push({ k: "accepted", label: "Accepted", when: DT(d.accepted_at), empty: d.status === "accepted" ? "Accepted (no date)" : "Not accepted yet", tone: d.accepted_at || d.status === "accepted" ? "done" : "wait" });
  }
  d.invoices.forEach((v) => {
    const total = Number(v.grand_total || 0); const st = String(v.status || "");
    const label = `${d.kind === "quote" ? `Invoice ${v.invoice_number || ""} · ` : ""}`;
    if (st === "paid") s.push({ k: `paid-${v.id}`, label: `${label}Paid in full · ${R(total)}`, when: DT(v.paid_date), empty: "Paid (no date)", tone: "done" });
    else if (st === "partially_paid" || (v.paid ?? 0) > 0) s.push({ k: `paid-${v.id}`, label: `${label}Part-paid${v.paid != null ? ` · ${R(v.paid)} of ${R(total)} · balance ${R(Math.max(0, total - v.paid))}` : ""}`, when: DT(v.paid_date), empty: "", tone: "wait" });
    else s.push({ k: `paid-${v.id}`, label: `${label}${st === "draft" ? "Draft, not sent" : "Not paid"} · ${R(total)}`, when: null, empty: "", tone: "wait" });
  });
  return s;
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right font-semibold text-foreground">{v}</span></div>;
}

export function RecordTimeline({ d }: { d: RecordData }) {
  const dot = { done: "bg-[#22C55E]", bad: "bg-[#EF4444]", wait: "bg-muted-foreground/40" };
  return (
    <ol className="rounded-xl border bg-card px-3 py-1" data-testid="record-timeline">
      {timelineSteps(d).map((x) => (
        <li key={x.k} className="flex items-start gap-2.5 py-1.5 text-sm" data-step={x.k} data-has-date={x.when ? "1" : "0"}>
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[x.tone || "wait"]}`} />
          <span className="min-w-0 flex-1 text-foreground">{x.label}</span>
          <span className={`shrink-0 text-right ${x.when ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{x.when ?? x.empty}</span>
        </li>
      ))}
    </ol>
  );
}

export function RecordBody({ r, d, loading, onClose, onSnooze, onChanged }: { r: RecordRef; d: RecordData | null | undefined; loading?: boolean; onClose: () => void; onSnooze?: () => void; onChanged?: () => void }) {
  const isQ = r.kind === "quote";
  const editTo = isQ ? `/admin/estimates/${r.id}` : `/admin/invoices/${r.id}`;
  return (
    <div className="space-y-3" data-testid="record-sheet">
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : !d ? <p className="text-sm text-muted-foreground">No details found.</p> : <>
        <div className="divide-y divide-border rounded-xl border bg-card px-3">
          <Line k={isQ ? "Quote" : "Invoice"} v={d.number || "—"} /><Line k="Client" v={d.client || "—"} />
          <Line k="Total incl. VAT" v={R(d.total)} /><Line k="Status" v={<span className="capitalize">{(d.status || "—").replace(/_/g, " ")}</span>} />
          {d.rooms && <div className="py-2 text-sm text-foreground/90">{d.rooms}</div>}
        </div>
        <RecordTimeline d={d} />
      </>}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {isQ && <Button asChild><Link to={`/admin/quote-preview/${r.id}`} onClick={onClose} data-testid="sheet-client-view">Client view</Link></Button>}
        <Button asChild variant="outline"><Link to={editTo} onClick={onClose} data-testid="sheet-edit">{isQ ? "Edit quote" : "Open invoice"}</Link></Button>
        {r.primary && <Button asChild variant="outline"><Link to={r.primary.to} onClick={onClose} data-testid="sheet-action">{r.primary.label}</Link></Button>}
        {d?.status === "draft" && <MarkSentManuallyButton anyRole kind={r.kind} id={r.id} status={d.status} size="default" className="w-full" onDone={onChanged} />}
        {onSnooze && <Button variant="outline" onClick={onSnooze} data-testid="sheet-snooze">{isQ ? "Snooze / Group" : "Snooze"}</Button>}
      </div>
      <Button variant="ghost" className="w-full" onClick={onClose}>Close</Button>
    </div>
  );
}

/** Sheet on phones, dialog on desktop: same pattern as the Next steps pop-up (PR #105). */
export default function RecordSheet({ r, onClose, onChanged }: { r: RecordRef | null; onClose: () => void; onChanged?: () => void }) {
  const isMobile = useIsMobile(); const qc = useQueryClient();
  const [snoozing, setSnoozing] = useState(false);
  const q = useQuery({ queryKey: ["record-sheet", r?.kind, r?.id], enabled: !!r, queryFn: () => loadRecord(r!) });
  if (!r) return null;
  const changed = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["sales-heartbeat"] }); qc.invalidateQueries({ queryKey: ["sales-next-steps"] }); onChanged?.(); };
  const body = <RecordBody r={r} d={q.data} loading={q.isLoading} onClose={onClose} onChanged={changed} onSnooze={r.snoozeRule ? () => setSnoozing(true) : undefined} />;
  const row = { rule: r.snoozeRule, entity_type: r.kind, entity_id: r.id, title: r.title, detail: q.data?.number || "" } as unknown as NextStep;
  const snooze = async (o: { until?: Date; dismiss?: boolean; reason: string }) => {
    const { error } = await (supabase.rpc as any)("snooze_next_step", { p_rule: r.snoozeRule, p_entity_type: r.kind, p_entity_id: r.id, p_until: o.until?.toISOString() ?? null, p_dismiss: !!o.dismiss, p_reason: o.reason });
    if (error) throw error; changed(); onClose();
  };
  const group = async (other: string) => {
    const { error } = await (supabase.rpc as any)("group_quote_option", { p_quote: r.id, p_other: other });
    if (error) throw error; changed();
  };
  return <>
    {isMobile ? (
      <Drawer open={!snoozing} onOpenChange={(o) => !o && !snoozing && onClose()}>
        <DrawerContent className="max-h-[88vh] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          <DrawerHeader className="px-0 text-left"><DrawerTitle>{r.title}</DrawerTitle></DrawerHeader><div className="overflow-y-auto">{body}</div>
        </DrawerContent>
      </Drawer>
    ) : (
      <Dialog open={!snoozing} onOpenChange={(o) => !o && !snoozing && onClose()}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{r.title}</DialogTitle></DialogHeader>{body}</DialogContent>
      </Dialog>
    )}
    {snoozing && <SnoozeDialog row={row} onClose={() => setSnoozing(false)} onSave={snooze} onGroup={group} />}
  </>;
}

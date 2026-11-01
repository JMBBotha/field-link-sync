import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { RULES, buttonTarget, cardTarget, daysSince, recordKind, shortDescription, type NextStep } from "@/lib/nextSteps";

const R = (n: number | null | undefined) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const D = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }) : "—");

type Summary = { number: string; client: string; total: number | null; status: string; sent: string | null; created: string | null; desc: string; when?: string; address?: string; phone?: string };

/** Loads only the one record the row points at (RLS / company scope applies as on its own page). */
async function loadSummary(row: NextStep): Promise<Summary | null> {
  const id = row.entity_id; const kind = recordKind(row);
  if (kind === "quote") {
    const [q, a, i] = await Promise.all([
      (supabase.from("quotes") as any).select("quote_number, customer_name, total, status, sent_at, created_at").eq("id", id).maybeSingle(),
      (supabase.from("quote_areas") as any).select("name, sort_order").eq("quote_id", id).order("sort_order", { nullsFirst: false }),
      (supabase.from("quote_items") as any).select("item_name, sort_order").eq("quote_id", id).is("parent_item_id", null).order("sort_order").limit(6),
    ]);
    if (!q.data) return null;
    return { number: q.data.quote_number, client: q.data.customer_name, total: q.data.total, status: q.data.status, sent: q.data.sent_at, created: q.data.created_at,
      desc: shortDescription((a.data || []).map((x: any) => x.name), (i.data || []).map((x: any) => x.item_name)) };
  }
  if (kind === "invoice") {
    const [inv, it] = await Promise.all([
      (supabase.from("invoices") as any).select("invoice_number, customer_name, grand_total, status, sent_at, created_at").eq("id", id).maybeSingle(),
      (supabase.from("invoice_items") as any).select("line_name, description, room_label, sort_order").eq("invoice_id", id).order("sort_order").limit(8),
    ]);
    if (!inv.data) return null;
    const items = (it.data || []) as any[];
    return { number: inv.data.invoice_number, client: inv.data.customer_name, total: inv.data.grand_total, status: inv.data.status, sent: inv.data.sent_at, created: inv.data.created_at,
      desc: shortDescription([...new Set(items.map((x) => x.room_label).filter(Boolean))] as string[], items.map((x) => x.line_name || x.description)) };
  }
  if (kind === "lead") {
    const { data } = await (supabase.from("leads") as any).select("customer_name, customer_address, phone, customer_phone, service_type, scheduled_date, scheduled_time, status, created_at, notes").eq("id", id).maybeSingle();
    if (!data) return null;
    return { number: data.service_type || "Site visit", client: data.customer_name, total: null, status: data.status, sent: null, created: data.created_at,
      desc: (data.notes || "").split("\n")[0].slice(0, 140), when: data.scheduled_date ? `${D(data.scheduled_date)}${data.scheduled_time ? ` · ${String(data.scheduled_time).slice(0, 5)}` : ""}` : "Not booked",
      address: data.customer_address, phone: data.customer_phone || data.phone };
  }
  return null;
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right font-semibold text-foreground">{v}</span></div>;
}

export function NextStepSummaryBody({ row, s, loading, onClose }: { row: NextStep; s: Summary | null | undefined; loading?: boolean; onClose: () => void }) {
  const kind = recordKind(row); const d = daysSince(s?.sent);
  const openLabel = kind === "quote" ? "Open quote" : kind === "invoice" ? "Open invoice" : kind === "lead" ? "Open appointment" : "Open";
  return (
    <div className="space-y-3" data-testid="next-step-sheet">
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : !s ? <p className="text-sm text-muted-foreground">{row.detail || "No details found."}</p> : (
        <div className="divide-y divide-border rounded-xl border bg-card px-3">
          {kind === "lead" ? <>
            <Line k="Client" v={s.client || "—"} /><Line k="Appointment" v={s.when} /><Line k="Type" v={s.number} />
            {s.address && <Line k="Address" v={s.address} />}{s.phone && <Line k="Phone" v={<a className="text-sky-600 dark:text-sky-300" href={`tel:${s.phone}`}>{s.phone}</a>} />}
            <Line k="Status" v={s.status || "—"} />
          </> : <>
            <Line k={kind === "quote" ? "Quote" : "Invoice"} v={s.number} /><Line k="Client" v={s.client || "—"} />
            <Line k="Total incl. VAT" v={R(s.total)} /><Line k="Status" v={<span className="capitalize">{(s.status || "—").replace(/_/g, " ")}</span>} />
            <Line k={s.sent ? "Sent" : "Created"} v={D(s.sent || s.created)} />
            {d != null && <Line k="Days since sent" v={`${d} day${d === 1 ? "" : "s"}`} />}
          </>}
          {s.desc && <div className="py-2 text-sm text-foreground/90">{s.desc}</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild className="flex-1"><Link to={cardTarget(row)} onClick={onClose} data-testid="sheet-open">{openLabel}</Link></Button>
        {row.rule !== "new_lead" && <Button asChild variant="outline" className="flex-1"><Link to={buttonTarget(row)} onClick={onClose} data-testid="sheet-action">{RULES[row.rule].action}</Link></Button>}
        <Button variant="ghost" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export default function NextStepSheet({ row, onClose }: { row: NextStep | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const q = useQuery({ queryKey: ["next-step-summary", row?.entity_type, row?.entity_id], enabled: !!row, queryFn: () => loadSummary(row!) });
  if (!row) return null;
  const title = row.title;
  const body = <NextStepSummaryBody row={row} s={q.data} loading={q.isLoading} onClose={onClose} />;
  return isMobile ? (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        <DrawerHeader className="px-0 text-left"><DrawerTitle>{title}</DrawerTitle></DrawerHeader><div className="overflow-y-auto">{body}</div>
      </DrawerContent>
    </Drawer>
  ) : (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>{body}</DialogContent>
    </Dialog>
  );
}

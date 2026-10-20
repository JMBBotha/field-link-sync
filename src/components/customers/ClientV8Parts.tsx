/** Client page V8 parts (Johan 20 Oct 13:30): activity timeline (read-only from existing tables), payment terms chip, sites overview. */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Mail, Phone, StickyNote, Clock, Repeat, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { termsLabel } from "@/lib/invoiceDue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sb = supabase as any;
export type ActivityItem = { id: string; at: string; kind: "email" | "call" | "note" | "reminder" | "followup" | "job"; text: string; sub?: string };
const ICON = { email: Mail, call: Phone, note: StickyNote, reminder: Clock, followup: Repeat, job: MapPin } as const;

export function buildActivity(src: {
  notes?: any[]; calls?: any[]; reports?: any[]; reminders?: any[]; sends?: any[]; followups?: any[]; jobLog?: any[];
  quoteNo?: Map<string, string>; jobTitle?: Map<string, string>;
}): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const n of src.notes || []) out.push({ id: "n" + n.id, at: n.created_at, kind: "note", text: n.body });
  for (const c of src.calls || []) out.push({ id: "c" + c.id, at: c.started_at || c.created_at, kind: "call",
    text: `${c.direction === "outbound" ? "Outgoing" : "Incoming"} call${c.duration_seconds ? ` · ${Math.max(1, Math.round(c.duration_seconds / 60))} min` : ""}`, sub: c.summary || c.outcome || undefined });
  for (const r of src.reports || []) out.push({ id: "r" + r.id, at: r.created_at, kind: "call", text: "Call report", sub: r.next_action || undefined });
  for (const p of src.reminders || []) out.push({ id: "p" + p.id, at: p.sent_at || p.created_at, kind: "reminder",
    text: `Payment reminder ${p.invoice_number || ""} · ${p.status === "sent" ? "emailed" : p.status === "pending" ? "waiting for approval" : p.status}` });
  for (const s of src.sends || []) out.push({ id: "s" + s.id, at: s.finished_at || s.started_at || s.created_at, kind: "email",
    text: `Quote ${src.quoteNo?.get(s.quote_id) || ""} emailed to ${s.recipient}`, sub: s.status === "sent" || s.status === "delivered" ? undefined : s.status });
  for (const f of src.followups || []) out.push({ id: "f" + f.id, at: f.created_at, kind: "followup",
    text: `Quote ${src.quoteNo?.get(f.quote_id) || ""} follow-up #${f.seq} · ${String(f.result || "").replace(/_/g, " ")}`, sub: f.note || undefined });
  for (const j of src.jobLog || []) out.push({ id: "j" + j.id, at: j.created_at, kind: "job",
    text: `${src.jobTitle?.get(j.job_id) || "Job"} · ${String(j.action || j.event_type || j.activity_type || "update").replace(/_/g, " ")}` });
  return out.filter((x) => x.at).sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

export function ClientActivity({ customerId, companyId, quotes, jobs }: { customerId: string; companyId: string | null; quotes: any[]; jobs: any[] }) {
  const qc = useQueryClient();
  const qIds = quotes.map((q) => q.id); const jIds = jobs.map((j) => j.id);
  const { data, isLoading } = useQuery({
    queryKey: ["client-activity", customerId, qIds.length, jIds.length],
    queryFn: async () => {
      const safe = async (p: any) => { try { const { data } = await p; return data || []; } catch { return []; } };
      const [notes, calls, reports, reminders, sends, followups, jobLog] = await Promise.all([
        safe(sb.from("customer_notes").select("id, body, created_at").eq("customer_id", customerId).is("archived_at", null).order("created_at", { ascending: false }).limit(50)),
        safe(sb.from("vapi_calls").select("id, direction, duration_seconds, summary, outcome, started_at, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50)),
        safe(sb.from("call_reports").select("id, next_action, created_at").eq("customer_id", customerId).eq("is_test", false).order("created_at", { ascending: false }).limit(30)),
        safe(sb.from("payment_followups").select("id, invoice_number, status, created_at, sent_at").eq("customer_id", customerId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(30)),
        qIds.length ? safe(sb.from("quote_email_sends").select("id, quote_id, recipient, status, created_at, started_at, finished_at").in("quote_id", qIds).order("created_at", { ascending: false }).limit(50)) : [],
        qIds.length ? safe(sb.from("quote_followups").select("id, quote_id, seq, result, note, created_at").in("quote_id", qIds).order("created_at", { ascending: false }).limit(50)) : [],
        jIds.length ? safe(sb.from("job_activity_log").select("*").in("job_id", jIds).order("created_at", { ascending: false }).limit(50)) : [],
      ]);
      return { notes, calls, reports, reminders, sends, followups, jobLog };
    },
  });
  const items = useMemo(() => buildActivity({ ...(data || {}), quoteNo: new Map(quotes.map((q) => [q.id, q.quote_number || ""])), jobTitle: new Map(jobs.map((j) => [j.id, j.title || "Job"])) }), [data, quotes, jobs]);
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  const addNote = async () => {
    const body = note.trim(); if (!body || !companyId) return;
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await sb.from("customer_notes").insert({ customer_id: customerId, company_id: companyId, body, author_id: u.user?.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    setNote(""); qc.invalidateQueries({ queryKey: ["client-activity", customerId] }); qc.invalidateQueries({ queryKey: ["customer-notes"] });
  };
  return (
    <div data-testid="client-activity">
      <div className="flex gap-2 mb-3">
        <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="Add a note…" className="rounded-xl" />
        <Button onClick={addNote} disabled={saving || !note.trim()} className="rounded-xl bg-[#1590D6] hover:bg-[#127bb8] text-white">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading activity…</p>
        : items.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No calls, emails or notes yet.</p>
        : <ul className="divide-y">{items.slice(0, 80).map((it) => { const I = ICON[it.kind]; return (
          <li key={it.id} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 rounded-full bg-[#E8F6FE] p-1.5 text-[#1590D6] dark:bg-sky-500/15 dark:text-sky-300"><I className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1"><p className="text-sm break-words">{it.text}</p>{it.sub && <p className="text-xs text-muted-foreground line-clamp-2 break-words">{it.sub}</p>}</div>
            <span className="shrink-0 text-xs text-muted-foreground">{format(new Date(it.at), "dd MMM HH:mm")}</span>
          </li>); })}</ul>}
    </div>
  );
}

export function PaymentTermsChip({ customerId, basis, days, canEdit, onSaved, tone = "dark" }: { customerId: string; basis?: string | null; days?: number | null; canEdit: boolean; onSaved?: () => void; tone?: "dark" | "light" }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState<string>(basis || "default"); const [d, setD] = useState<number>(days ?? (basis === "completion" ? 30 : 7));
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const save = async () => {
    setBusy(true);
    const { error } = await sb.rpc("set_customer_payment_terms", { p_customer: customerId, p_basis: b === "default" ? null : b, p_days: d });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Payment terms saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["invoice-due"] }); onSaved?.();
  };
  return (<>
    <button type="button" data-testid="payment-terms-chip" disabled={!canEdit} onClick={() => { setB(basis || "default"); setD(days ?? (basis === "completion" ? 30 : 7)); setOpen(true); }}
      className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tone === "dark" ? "bg-white/15 text-white" : "bg-[#E8F6FE] text-[#1590D6]", canEdit ? "hover:bg-white/25" : "cursor-default")}>
      Payment terms: {termsLabel(basis, days)}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Payment terms</DialogTitle>
          <DialogDescription>When this client's final invoices fall due. "After job completion" means no due date and no reminders until the job is done. Deposit invoices are not affected.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2">
          {[["default", "Company default (7 days after invoice)"], ["invoice", "Days after invoice"], ["completion", "Days after job completion"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setB(v); if (v === "completion" && b !== "completion") setD(30); }}
              className={cn("rounded-full border px-3 py-1.5 text-sm", b === v ? "border-[#1590D6] bg-[#E8F6FE] text-[#1590D6] font-semibold" : "")}>{l}</button>))}
        </div>
        {b !== "default" && <label className="flex items-center gap-2 text-sm">Days <Input type="number" min={0} max={365} value={d} onChange={(e) => setD(Math.max(0, Math.min(365, Number(e.target.value) || 0)))} className="w-24 rounded-xl" /></label>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} onClick={save} className="bg-[#F7941D] hover:bg-[#e08310] text-white">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>);
}

export function SitesOverview({ locations, quotes, jobs, invoices, onPick }: { locations: any[]; quotes: any[]; jobs: any[]; invoices: any[]; onPick: (id: string) => void }) {
  if (!locations.length) return <p className="text-sm text-muted-foreground py-4">No sites yet. Add one below.</p>;
  const n = (arr: any[], id: string) => arr.filter((x) => x.location_id === id).length;
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="sites-overview">
      {locations.map((l) => (
        <button key={l.id} type="button" onClick={() => onPick(l.id)} className="rounded-2xl border p-3 text-left hover:border-[#1590D6]">
          <p className="font-semibold text-sm">{l.label || "Site"}{l.is_primary && <span className="ml-2 rounded-full bg-[#E8F6FE] px-2 py-0.5 text-[11px] text-[#1590D6] dark:bg-sky-500/15 dark:text-sky-300">Primary</span>}</p>
          <p className="text-xs text-muted-foreground break-words">{l.address}</p>
          <p className="mt-1 text-xs">{n(quotes, l.id)} quotes · {n(jobs, l.id)} jobs · {n(invoices, l.id)} invoices</p>
        </button>))}
    </div>
  );
}

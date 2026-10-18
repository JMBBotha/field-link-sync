import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Loader2, Plus, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRand } from "@/utils/formatRand";
import { isoDate } from "@/lib/cashflow";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
const NONE = "__none";
type Bill = { id: string; supplier_id: string | null; supplier_name: string | null; po_id: string | null; job_id: string | null; bill_number: string | null; bill_date: string; due_date: string | null;
  amount_excl: number; vat_amount: number; amount_incl: number; amount_paid: number; status: string; notes: string | null; po?: { po_number: string } | null };
type Form = { id?: string; supplier_id: string; bill_number: string; bill_date: string; due_date: string; amount_incl: string; vat_included: boolean; job_id: string; notes: string; status: string };
const blank = (): Form => ({ supplier_id: NONE, bill_number: "", bill_date: isoDate(new Date()), due_date: "", amount_incl: "", vat_included: true, job_id: NONE, notes: "", status: "unpaid" });
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft (check)", cls: "bg-amber-100 text-amber-800" }, unpaid: { label: "Unpaid", cls: "bg-blue-100 text-blue-800" },
  part_paid: { label: "Part paid", cls: "bg-violet-100 text-violet-800" }, paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-800" }, void: { label: "Void", cls: "bg-muted text-muted-foreground" },
};

/** Owner + admin only. Supplier bills (money we owe), payments and bank-line matching. */
export default function AdminSupplierBillsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"open" | "overdue" | "paid" | "all">("open");
  const [form, setForm] = useState<Form | null>(null);
  const [pay, setPay] = useState<{ bill: Bill; amount: string; date: string; reference: string; line: string } | null>(null);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = isoDate(new Date());

  const { data: companyId } = useQuery({ queryKey: ["caller-company-id"], queryFn: async () => ((await db.rpc("caller_company_id")).data as string | null) ?? null });
  const { data: allowed } = useQuery({ queryKey: ["cf-ok", companyId], enabled: !!companyId, queryFn: async () => !!(await db.rpc("_cf_ok", { p_company: companyId })).data });
  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["supplier-bills", companyId], enabled: !!allowed,
    queryFn: async () => {
      const { data, error } = await db.from("supplier_bills").select("*, po:purchase_orders(po_number)").eq("company_id", companyId).order("due_date", { ascending: true });
      if (error) throw error; return (data || []) as Bill[];
    },
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["bill-suppliers"], enabled: !!allowed,
    queryFn: async () => ((await db.from("suppliers").select("id, name, trading_name, payment_terms_days").eq("is_active", true).order("name")).data || []) as { id: string; name: string; trading_name: string | null; payment_terms_days: number | null }[],
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["bill-jobs"], enabled: !!allowed,
    queryFn: async () => ((await db.from("jobs").select("id, title").order("created_at", { ascending: false }).limit(80)).data || []) as { id: string; title: string | null }[],
  });
  const { data: lines = [] } = useQuery({
    queryKey: ["bill-bank-lines", companyId], enabled: !!pay,
    queryFn: async () => ((await db.from("bank_lines").select("id, txn_date, amount, description, reference").eq("company_id", companyId).eq("status", "new").lt("amount", 0).order("txn_date", { ascending: false }).limit(100)).data || []) as { id: string; txn_date: string; amount: number; description: string | null; reference: string | null }[],
  });

  const shown = useMemo(() => bills.filter((b) => {
    const open = ["draft", "unpaid", "part_paid"].includes(b.status);
    if (filter === "open") return open;
    if (filter === "overdue") return open && !!b.due_date && b.due_date < today;
    if (filter === "paid") return b.status === "paid";
    return true;
  }), [bills, filter, today]);
  const owed = bills.filter((b) => ["draft", "unpaid", "part_paid"].includes(b.status)).reduce((s, b) => s + Number(b.amount_incl) - Number(b.amount_paid), 0);
  const overdueAmt = bills.filter((b) => ["draft", "unpaid", "part_paid"].includes(b.status) && b.due_date && b.due_date < today).reduce((s, b) => s + Number(b.amount_incl) - Number(b.amount_paid), 0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["supplier-bills"] }); qc.invalidateQueries({ queryKey: ["cashflow"] }); };

  if (allowed === false) return <div className="p-6 text-sm text-muted-foreground">Only owners and admins can see supplier bills.</div>;

  const save = async () => {
    if (!form || !companyId) return;
    const incl = Number(form.amount_incl);
    if (!(incl > 0)) return toast({ title: "Enter the bill amount (incl. VAT)", variant: "destructive" });
    if (form.supplier_id === NONE) return toast({ title: "Pick the supplier", variant: "destructive" });
    const vat = form.vat_included ? Math.round((incl - incl / 1.15) * 100) / 100 : 0;
    const payload: Record<string, unknown> = { company_id: companyId, supplier_id: form.supplier_id, supplier_name: null, bill_number: form.bill_number || null, bill_date: form.bill_date,
      due_date: form.due_date || null, amount_incl: incl, vat_amount: vat, amount_excl: Math.round((incl - vat) * 100) / 100, job_id: form.job_id === NONE ? null : form.job_id, notes: form.notes || null, status: form.status };
    if (form.id) { delete payload.supplier_name; delete payload.company_id; }
    setBusy(true);
    const { error } = form.id ? await db.from("supplier_bills").update(payload).eq("id", form.id) : await db.from("supplier_bills").insert(payload);
    setBusy(false);
    if (error) return toast({ title: "Could not save the bill", description: error.message, variant: "destructive" });
    toast({ title: form.id ? "Bill updated" : "Bill added" }); setForm(null); refresh();
  };
  const edit = (b: Bill) => setForm({ id: b.id, supplier_id: b.supplier_id || NONE, bill_number: b.bill_number || "", bill_date: b.bill_date, due_date: b.due_date || "", amount_incl: String(b.amount_incl),
    vat_included: Number(b.vat_amount) > 0, job_id: b.job_id || NONE, notes: b.notes || "", status: b.status === "draft" ? "unpaid" : b.status });
  const voidBill = async (b: Bill) => {
    if (!window.confirm(`Void bill ${b.bill_number || ""} from ${b.supplier_name || "supplier"}?`)) return;
    const { error } = await db.from("supplier_bills").update({ status: "void" }).eq("id", b.id);
    if (error) return toast({ title: "Could not void", description: error.message, variant: "destructive" }); refresh();
  };
  const recordPay = async () => {
    if (!pay) return;
    setBusy(true);
    const { error } = await db.rpc("record_bill_payment", { p_bill: pay.bill.id, p_amount: Number(pay.amount) || null, p_date: pay.date, p_method: "eft",
      p_reference: pay.reference || null, p_bank_line: pay.line === NONE ? null : pay.line });
    setBusy(false);
    if (error) return toast({ title: "Payment not recorded", description: error.message, variant: "destructive" });
    toast({ title: "Payment recorded" }); setPay(null); refresh(); qc.invalidateQueries({ queryKey: ["bill-bank-lines"] });
  };
  const saveTerms = async (id: string, days: string) => {
    const { error } = await db.from("suppliers").update({ payment_terms_days: days === "" ? null : Number(days) }).eq("id", id);
    if (error) toast({ title: "Could not save terms", description: error.message, variant: "destructive" });
    else { toast({ title: "Payment terms saved" }); qc.invalidateQueries({ queryKey: ["bill-suppliers"] }); }
  };

  return (
    <div className="space-y-4 p-3 md:p-6" data-testid="supplier-bills">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-bold">Supplier bills</h1><p className="text-xs text-muted-foreground">Money we owe suppliers for units and materials. Owner and admin only.</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTerms(true)}>Payment terms</Button>
          <Button size="sm" onClick={() => setForm(blank())}><Plus className="mr-1 h-4 w-4" />Add bill</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">We owe (open bills)</div><div className="text-lg font-bold">{formatRand(owed)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Overdue</div><div className={`text-lg font-bold ${overdueAmt > 0 ? "text-red-600" : ""}`}>{formatRand(overdueAmt)}</div></CardContent></Card>
        <Card className="col-span-2 md:col-span-1"><CardContent className="p-3"><div className="text-xs text-muted-foreground">Drafts to check</div><div className="text-lg font-bold">{bills.filter((b) => b.status === "draft").length}</div></CardContent></Card>
      </div>
      <div className="flex flex-wrap gap-1">
        {(["open", "overdue", "paid", "all"] as const).map((f) => <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="h-7 capitalize" onClick={() => setFilter(f)}>{f}</Button>)}
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : shown.length === 0 ? <p className="text-sm text-muted-foreground">No bills here.</p> : (
        <div className="space-y-2">
          {shown.map((b) => {
            const out = Number(b.amount_incl) - Number(b.amount_paid);
            const late = ["draft", "unpaid", "part_paid"].includes(b.status) && b.due_date && b.due_date < today;
            return (
              <Card key={b.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{(b.supplier_name || "Supplier").trim()}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[b.status]?.cls}`}>{STATUS[b.status]?.label}</span>
                    {late && <Badge variant="destructive" className="h-5 text-xs">Overdue</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{b.bill_number ? `Bill ${b.bill_number}` : "No bill number yet"}{b.po?.po_number ? ` · ${b.po.po_number}` : ""} · billed {b.bill_date} · due {b.due_date || "—"}</div>
                  {b.notes && <div className="text-xs text-muted-foreground">{b.notes}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right"><div className="font-semibold">{formatRand(Number(b.amount_incl))}</div>{Number(b.amount_paid) > 0 && <div className="text-xs text-muted-foreground">owing {formatRand(out)}</div>}</div>
                  {b.status !== "void" && <Button size="sm" variant="outline" className="h-8" onClick={() => edit(b)}>{b.status === "draft" ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Check</> : "Edit"}</Button>}
                  {["draft", "unpaid", "part_paid"].includes(b.status) && <Button size="sm" className="h-8" onClick={() => setPay({ bill: b, amount: out.toFixed(2), date: today, reference: "", line: NONE })}><Wallet className="mr-1 h-3.5 w-3.5" />Pay</Button>}
                  {b.status !== "void" && b.status !== "paid" && Number(b.amount_paid) === 0 && <Button size="icon" variant="ghost" className="h-8 w-8" title="Void" onClick={() => voidBill(b)}><Ban className="h-4 w-4" /></Button>}
                </div>
              </CardContent></Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form?.id ? "Supplier bill" : "Add supplier bill"}</DialogTitle><DialogDescription>Leave the due date empty to use the supplier's payment terms (30 days if not set).</DialogDescription></DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div><Label>Supplier</Label>
                <Select value={form.supplier_id} onValueChange={(v) => setForm({ ...form, supplier_id: v })}><SelectTrigger><SelectValue placeholder="Pick supplier" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{(s.trading_name || s.name).trim()}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Supplier invoice no.</Label><Input value={form.bill_number} onChange={(e) => setForm({ ...form, bill_number: e.target.value })} /></div>
                <div><Label>Amount incl. VAT</Label><Input inputMode="decimal" value={form.amount_incl} onChange={(e) => setForm({ ...form, amount_incl: e.target.value })} /></div>
                <div><Label>Bill date</Label><Input type="date" value={form.bill_date} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} /></div>
                <div><Label>Due date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.vat_included} onChange={(e) => setForm({ ...form, vat_included: e.target.checked })} /> Includes 15% VAT</label>
              <div><Label>Job (optional, for profit per job)</Label>
                <Select value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>No job</SelectItem>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.title || j.id.slice(0, 8)}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>{pay?.bill.supplier_name} {pay?.bill.bill_number || ""}: pick the FNB line (money out) to match it, or type the amount.</DialogDescription></DialogHeader>
          {pay && (
            <div className="grid gap-3">
              <div><Label>Bank line</Label>
                <Select value={pay.line} onValueChange={(v) => setPay({ ...pay, line: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>Not from the bank list</SelectItem>
                    {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.txn_date} · {formatRand(-Number(l.amount))} · {(l.description || l.reference || "").slice(0, 40)}</SelectItem>)}</SelectContent></Select></div>
              {pay.line === NONE && <div className="grid grid-cols-2 gap-2">
                <div><Label>Amount</Label><Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
                <div><Label>Date paid</Label><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
                <div className="col-span-2"><Label>Reference</Label><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
              </div>}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setPay(null)}>Cancel</Button><Button onClick={recordPay} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Record</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={terms} onOpenChange={setTerms}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Supplier payment terms</DialogTitle><DialogDescription>Days after the bill date that payment is due. Empty = 30 days.</DialogDescription></DialogHeader>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {suppliers.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{(s.trading_name || s.name).trim()}</span>
                <Input className="h-8 w-20" inputMode="numeric" defaultValue={s.payment_terms_days ?? ""} placeholder="30" onBlur={(e) => { if (e.target.value !== String(s.payment_terms_days ?? "")) saveTerms(s.id, e.target.value); }} /></div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

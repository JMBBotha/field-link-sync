import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Paperclip, Pencil, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRand } from "@/utils/formatRand";
import { EXPENSE_CATEGORIES, categoryLabel, expenseTotals, receiptPath, splitInclusive, type ExpenseRow } from "@/lib/expenses";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const NONE = "__none";
type Form = { id?: string; expense_date: string; supplier_id: string; supplier_name: string; category: string; description: string; amount_incl: string; vat_claimable: boolean; reference: string; job_id: string; receipt_path: string | null };
const blank = (): Form => ({ expense_date: iso(new Date()), supplier_id: NONE, supplier_name: "", category: "materials", description: "", amount_incl: "", vat_claimable: true, reference: "", job_id: NONE, receipt_path: null });

/** Office-only expenses (supplier, category, incl/VAT/excl by date, private receipt, optional job). */
export default function AdminExpensesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const [to, setTo] = useState(iso(now));
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: companyId } = useQuery({
    queryKey: ["caller-company-id"],
    queryFn: async () => ((await (supabase as any).rpc("caller_company_id")).data as string | null) ?? null,
  });
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["expenses", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase.from("expenses" as any) as any).select("*").gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ExpenseRow[];
    },
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["expense-suppliers"],
    queryFn: async () => ((await supabase.from("suppliers").select("id, name, trading_name").eq("is_active", true).order("name")).data || []) as { id: string; name: string; trading_name: string | null }[],
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["expense-jobs"],
    queryFn: async () => ((await supabase.from("jobs").select("id, title, created_at").order("created_at", { ascending: false }).limit(60)).data || []) as { id: string; title: string | null }[],
  });

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.status !== "archived" && (!s || [r.supplier_name, r.description, r.reference, categoryLabel(r.category)].some((v) => (v || "").toLowerCase().includes(s))));
  }, [rows, q]);
  const totals = expenseTotals(shown);
  const preview = form ? splitInclusive(Number(form.amount_incl) || 0, form.expense_date, form.vat_claimable) : null;

  const openEdit = (r: ExpenseRow) => {
    setFile(null);
    setForm({ id: r.id, expense_date: r.expense_date, supplier_id: r.supplier_id || NONE, supplier_name: r.supplier_name || "", category: r.category, description: r.description || "", amount_incl: String(r.amount_incl), vat_claimable: r.vat_claimable, reference: r.reference || "", job_id: r.job_id || NONE, receipt_path: r.receipt_path });
  };

  const save = async () => {
    if (!form || !companyId) return;
    const amt = Number(form.amount_incl);
    if (!(amt > 0)) return toast({ title: "Enter the amount (incl. VAT)", variant: "destructive" });
    setSaving(true);
    try {
      let path = form.receipt_path;
      if (file) {
        path = receiptPath(companyId, file.name);
        const up = await supabase.storage.from("expense-receipts").upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (up.error) throw up.error;
      }
      const payload: Record<string, unknown> = {
        expense_date: form.expense_date,
        supplier_id: form.supplier_id === NONE ? null : form.supplier_id,
        supplier_name: form.supplier_id === NONE ? form.supplier_name.trim() || null : null,
        category: form.category,
        description: form.description.trim() || null,
        amount_incl: amt,
        vat_claimable: form.vat_claimable,
        reference: form.reference.trim() || null,
        job_id: form.job_id === NONE ? null : form.job_id,
        receipt_path: path,
      };
      const t = supabase.from("expenses" as any) as any;
      const res = form.id ? await t.update(payload).eq("id", form.id) : await t.insert({ ...payload, company_id: companyId });
      if (res.error) throw res.error;
      toast({ title: form.id ? "Expense updated" : "Expense recorded" });
      setForm(null);
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (e: any) {
      toast({ title: "Could not save expense", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const archive = async (r: ExpenseRow) => {
    const { error } = await (supabase.from("expenses" as any) as any).update({ status: "archived" }).eq("id", r.id);
    if (error) return toast({ title: "Could not archive", description: error.message, variant: "destructive" });
    toast({ title: "Expense archived" });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };
  const openReceipt = async (path: string) => {
    const { data, error } = await supabase.storage.from("expense-receipts").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return toast({ title: "Receipt unavailable", description: error?.message, variant: "destructive" });
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="space-y-4 p-3 md:p-6" data-testid="expenses-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <Button onClick={() => { setFile(null); setForm(blank()); }} data-testid="expense-new"><Plus className="mr-1 h-4 w-4" />Add expense</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" /></div>
        <div className="relative min-w-[180px] flex-1"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier, note, ref" className="h-9 pl-8" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="expense-totals">
        {[["Expenses", String(totals.count)], ["Excl. VAT", formatRand(totals.excl)], ["Input VAT", formatRand(totals.vat)], ["Incl. VAT", formatRand(totals.incl)]].map(([l, v]) => (
          <Card key={l}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="font-semibold">{v}</div></CardContent></Card>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{(error as any).message}</p>}
      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div> : (
            <ul className="divide-y">
              {shown.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 text-sm" data-testid="expense-row">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.supplier_name || r.description || categoryLabel(r.category)}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.expense_date} · {categoryLabel(r.category)}{r.reference ? ` · ${r.reference}` : ""}{r.source !== "manual" ? ` · ${r.source}` : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold whitespace-nowrap">{formatRand(Number(r.amount_incl))}</div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">VAT {formatRand(Number(r.vat_amount))}{Number(r.vat_rate) ? ` (${Number(r.vat_rate)}%)` : ""}</div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    {r.receipt_path && <Button size="icon" variant="ghost" className="h-8 w-8" title="Receipt" onClick={() => openReceipt(r.receipt_path!)}><Paperclip className="h-4 w-4" /></Button>}
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Archive" onClick={() => archive(r)}><Archive className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
              {shown.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No expenses in this period.</li>}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit expense" : "Add expense"}</DialogTitle>
            <DialogDescription>Enter the amount including VAT; VAT is worked out from the date (14% before 1 Apr 2018, else 15%).</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
                <div className="space-y-1"><Label>Amount (incl. VAT)</Label><Input inputMode="decimal" value={form.amount_incl} onChange={(e) => setForm({ ...form, amount_incl: e.target.value.replace(",", ".") })} data-testid="expense-amount" /></div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>Supplier charged VAT{preview ? ` — VAT ${formatRand(preview.vat)} · excl. ${formatRand(preview.excl)}` : ""}</span>
                <Switch checked={form.vat_claimable} onCheckedChange={(v) => setForm({ ...form, vat_claimable: v })} />
              </div>
              <div className="space-y-1">
                <Label>Supplier</Label>
                <Select value={form.supplier_id} onValueChange={(v) => setForm({ ...form, supplier_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Other (type below)</SelectItem>
                    {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.trading_name || s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.supplier_id === NONE && <Input placeholder="Supplier name" value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} />}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{EXPENSE_CATEGORIES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Invoice / slip no." /></div>
              </div>
              <div className="space-y-1">
                <Label>Job (optional)</Label>
                <Select value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No job</SelectItem>
                    {jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.title || j.id.slice(0, 8)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Note</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Receipt (photo or PDF)</Label>
                <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                {form.receipt_path && !file && <p className="text-xs text-muted-foreground">A receipt is attached; choose a file to replace it.</p>}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving} data-testid="expense-save">{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const FBPaymentsList = () => {
  const { companyId } = useCompany();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ amount: "", method: "bank_transfer", date: new Date().toISOString().split("T")[0], invoice_id: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["fb-payments", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("*, company_invoices:company_invoice_id(invoice_number, total_amount, status)").eq("company_id", companyId!).order("date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["company-invoices-for-payment", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("company_invoices" as any).select("id, invoice_number, total_amount, status").eq("company_id", companyId!).neq("status", "Paid").neq("status", "Archived");
      return data || [];
    },
    enabled: !!companyId,
  });

  const totalReceived = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_payments").insert({
        company_id: companyId!, amount: Number(form.amount), method: form.method, date: form.date,
        company_invoice_id: form.invoice_id || null,
      } as any);
      if (error) throw error;

      if (form.invoice_id) {
        const inv = invoices.find((i: any) => i.id === form.invoice_id);
        if (inv) {
          const existingPayments = payments.filter((p: any) => p.company_invoice_id === form.invoice_id).reduce((s: number, p: any) => s + Number(p.amount), 0);
          const newTotal = existingPayments + Number(form.amount);
          if (newTotal >= Number(inv.total_amount)) {
            await supabase.from("company_invoices" as any).update({ status: "Paid", amount_paid: newTotal }).eq("id", form.invoice_id);
          } else {
            await supabase.from("company_invoices" as any).update({ status: "Partial", amount_paid: newTotal }).eq("id", form.invoice_id);
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-payments"] });
      qc.invalidateQueries({ queryKey: ["company-invoices"] });
      setShowCreate(false);
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_payments").delete().in("id", Array.from(selectedIds));
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-payments"] });
      qc.invalidateQueries({ queryKey: ["fb-payments-all"] });
      const c = selectedIds.size; setSelectedIds(new Set());
      toast({ title: `${c} payments deleted` });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const toggleAll = () => {
    if (selectedIds.size === payments.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(payments.map((p: any) => p.id)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Payments</h2>
          <p className="text-sm text-muted-foreground">Total received: {fmt(totalReceived)}</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button size="sm" variant="destructive" onClick={() => bulkDeleteMutation.mutate()}>
              <Trash2 className="h-4 w-4 mr-1" />Delete ({selectedIds.size})
            </Button>
          )}
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Plus className="h-4 w-4 mr-2" />Record Payment</Button>
        </div>
      </div>
      <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="px-4 py-3 w-10"><Checkbox checked={selectedIds.size === payments.length && payments.length > 0} onCheckedChange={toggleAll} /></th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice Status</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            : payments.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No payments</td></tr>
            : payments.map((p: any) => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3"><Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} /></td>
                <td className="px-4 py-3">{p.date}</td>
                <td className="px-4 py-3 text-blue-600">{p.company_invoices?.invoice_number || "—"}</td>
                <td className="px-4 py-3 capitalize">{p.method?.replace("_", " ")}</td>
                <td className="px-4 py-3">
                  {p.company_invoices?.status ? (
                    <Badge variant="secondary" className={p.company_invoices.status === "Paid" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                      {p.company_invoices.status}
                    </Badge>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">{fmt(Number(p.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Invoice (optional)</Label>
              <Select value={form.invoice_id} onValueChange={v => setForm(f => ({ ...f, invoice_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select invoice" /></SelectTrigger>
                <SelectContent>{invoices.map((i: any) => (
                   <SelectItem key={i.id} value={i.id}>
                    {i.invoice_number} — R {Number(i.total_amount).toLocaleString()}
                  </SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            </div>
            <div><Label>Method</Label>
              <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="eft">EFT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.amount} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">Record Payment</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBPaymentsList;

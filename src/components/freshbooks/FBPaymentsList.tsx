import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const FBPaymentsList = () => {
  const { companyId } = useCompany();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ amount: "", method: "bank_transfer", date: new Date().toISOString().split("T")[0], invoice_id: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["fb-payments", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("*, fb_invoices(invoice_number)").eq("company_id", companyId!).order("date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["fb-invoices-for-payment", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_invoices").select("id, invoice_number").eq("company_id", companyId!).neq("status", "paid");
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_payments").insert({
        company_id: companyId!, amount: Number(form.amount), method: form.method, date: form.date,
        invoice_id: form.invoice_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-payments"] }); setShowCreate(false); toast({ title: "Payment recorded" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Payments</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]"><Plus className="h-4 w-4 mr-2" />Record Payment</Button>
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-[hsl(0,0%,98%)]">
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Date</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Invoice</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Method</th>
            <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Amount</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            : payments.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No payments</td></tr>
            : payments.map((p: any) => (
              <tr key={p.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)]">
                <td className="px-4 py-3">{p.date}</td>
                <td className="px-4 py-3 text-[hsl(211,100%,43%)]">{p.fb_invoices?.invoice_number || "—"}</td>
                <td className="px-4 py-3 capitalize">{p.method?.replace("_", " ")}</td>
                <td className="px-4 py-3 text-right font-medium text-[hsl(125,49%,34%)]">R {Number(p.amount).toLocaleString()}</td>
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
                <SelectContent>{invoices.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.invoice_number}</SelectItem>)}</SelectContent>
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
            <Button onClick={() => createMutation.mutate()} disabled={!form.amount} className="w-full bg-[hsl(211,100%,43%)]">Record Payment</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBPaymentsList;

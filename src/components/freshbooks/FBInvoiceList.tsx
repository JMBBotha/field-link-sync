import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Send, CheckCircle, MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-purple-100 text-purple-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
  partial: "bg-amber-100 text-amber-700",
};

const FBInvoiceList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "bank_transfer", date: new Date().toISOString().split("T")[0] });
  const [form, setForm] = useState({ invoice_number: "", amount: "", tax: "0", status: "draft", due_date: "", contact_id: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["fb-invoices", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_invoices").select("*, fb_contacts(name)").eq("company_id", companyId!).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["fb-contacts-list", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_contacts").select("id, name").eq("company_id", companyId!).order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  // Fetch payments for partial payment tracking
  const { data: allPayments = [] } = useQuery({
    queryKey: ["fb-payments-all", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("invoice_id, amount").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const getPaymentTotal = (invoiceId: string) => allPayments.filter((p: any) => p.invoice_id === invoiceId).reduce((s: number, p: any) => s + Number(p.amount), 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_invoices").insert({
        company_id: companyId!, invoice_number: form.invoice_number,
        amount: Number(form.amount), tax: Number(form.tax), status: form.status,
        due_date: form.due_date || null, contact_id: form.contact_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-invoices"] });
      setShowCreate(false);
      setForm({ invoice_number: "", amount: "", tax: "0", status: "draft", due_date: "", contact_id: "" });
      toast({ title: "Invoice created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("fb_invoices").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-invoices"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!showPayment) return;
      const { error } = await supabase.from("fb_payments").insert({
        company_id: companyId!, invoice_id: showPayment,
        amount: Number(paymentForm.amount), method: paymentForm.method, date: paymentForm.date,
      });
      if (error) throw error;
      // Check if fully paid
      const inv = invoices.find((i: any) => i.id === showPayment);
      const totalPaid = getPaymentTotal(showPayment) + Number(paymentForm.amount);
      if (inv && totalPaid >= Number(inv.amount)) {
        await supabase.from("fb_invoices").update({ status: "paid" }).eq("id", showPayment);
      } else {
        await supabase.from("fb_invoices").update({ status: "partial" }).eq("id", showPayment);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-invoices"] });
      qc.invalidateQueries({ queryKey: ["fb-payments"] });
      qc.invalidateQueries({ queryKey: ["fb-payments-all"] });
      setShowPayment(null);
      setPaymentForm({ amount: "", method: "bank_transfer", date: new Date().toISOString().split("T")[0] });
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = invoices.filter((inv: any) => {
    const matchesSearch = inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
      inv.fb_contacts?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Invoices</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]">
          <Plus className="h-4 w-4 mr-2" />New Invoice
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(0,0%,53%)]" />
          <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(0,0%,90%)] bg-[hsl(0,0%,98%)]">
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Invoice #</th>
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Client</th>
              <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Amount</th>
              <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Paid</th>
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Due Date</th>
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Status</th>
              <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No invoices found</td></tr>
            ) : filtered.map((inv: any) => {
              const paid = getPaymentTotal(inv.id);
              const remaining = Number(inv.amount) - paid;
              return (
                <tr key={inv.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[hsl(211,100%,43%)]">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-[hsl(0,0%,29%)]">{inv.fb_contacts?.name || "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-[hsl(0,0%,29%)]">R {Number(inv.amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[hsl(125,49%,34%)]">{paid > 0 ? `R ${paid.toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-3 text-[hsl(0,0%,53%)]">{inv.due_date || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className={statusColors[inv.status] || ""}>{inv.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {inv.status === "draft" && (
                          <DropdownMenuItem onClick={() => statusMutation.mutate({ id: inv.id, status: "sent" })}>
                            <Send className="h-4 w-4 mr-2" />Mark as Sent
                          </DropdownMenuItem>
                        )}
                        {!["paid", "cancelled"].includes(inv.status) && (
                          <>
                            <DropdownMenuItem onClick={() => {
                              setShowPayment(inv.id);
                              setPaymentForm(f => ({ ...f, amount: remaining.toString() }));
                            }}>
                              <CheckCircle className="h-4 w-4 mr-2" />Record Payment
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => statusMutation.mutate({ id: inv.id, status: "paid" })}>
                              Mark as Paid
                            </DropdownMenuItem>
                          </>
                        )}
                        {inv.status !== "cancelled" && (
                          <DropdownMenuItem onClick={() => statusMutation.mutate({ id: inv.id, status: "cancelled" })} className="text-red-600">
                            Cancel Invoice
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Invoice Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Invoice Number</Label><Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="INV-001" /></div>
            <div><Label>Client</Label>
              <Select value={form.contact_id} onValueChange={v => setForm(f => ({ ...f, contact_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{contacts.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Tax</Label><Input type="number" value={form.tax} onChange={e => setForm(f => ({ ...f, tax: e.target.value }))} /></div>
            </div>
            <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.invoice_number || !form.amount} className="w-full bg-[hsl(211,100%,43%)]">Create Invoice</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog open={!!showPayment} onOpenChange={() => setShowPayment(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input type="number" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Date</Label><Input type="date" value={paymentForm.date} onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))} /></div>
            </div>
            <div><Label>Method</Label>
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="eft">EFT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => paymentMutation.mutate()} disabled={!paymentForm.amount} className="w-full bg-[hsl(211,100%,43%)]">Record Payment</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBInvoiceList;

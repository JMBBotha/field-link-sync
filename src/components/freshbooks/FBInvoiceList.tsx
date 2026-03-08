import { useState, useEffect } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Send, CheckCircle, MoreHorizontal, FileDown, Archive, Trash2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const statusColors: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Sent: "bg-blue-100 text-blue-700",
  Viewed: "bg-blue-100 text-blue-700",
  Partial: "bg-blue-50 text-blue-600",
  Paid: "bg-green-100 text-green-700",
  Overdue: "bg-red-100 text-red-700",
  Archived: "bg-yellow-100 text-yellow-700",
};

const FBInvoiceList = () => {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "bank_transfer", date: new Date().toISOString().split("T")[0] });
  const [form, setForm] = useState({ invoice_number: "", amount: "", tax: "0", status: "Draft", due_date: "", contact_id: "", recurrence_interval: "none", recurrence_end_date: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["company-invoices", companyId],
    queryFn: async () => {
      const { data } = await (supabase.from("company_invoices" as any).select("*, fb_contacts(name)").eq("company_id", companyId!).order("created_at", { ascending: false }) as any);
      return (data || []) as any[];
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

  const { data: allPayments = [] } = useQuery({
    queryKey: ["fb-payments-all", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("company_invoice_id, amount").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  // Auto-overdue check on mount
  useEffect(() => {
    if (!invoices.length) return;
    const today = new Date().toISOString().split("T")[0];
    const toOverdue = invoices.filter((i: any) => i.due_date && i.due_date < today && !["Paid", "Archived", "Overdue"].includes(i.status));
    if (toOverdue.length > 0) {
      const ids = toOverdue.map((i: any) => i.id);
      supabase.from("company_invoices" as any).update({ status: "Overdue" }).in("id", ids).then(() => {
        if (ids.length > 0) qc.invalidateQueries({ queryKey: ["company-invoices"] });
      });
    }
  }, [invoices, qc]);

  // Auto-generate recurring invoices on mount
  useEffect(() => {
    if (!invoices.length || !companyId) return;
    const today = new Date().toISOString().split("T")[0];
    const recurring = invoices.filter((i: any) => {
      const rec = i.recurrence as any;
      if (!rec?.interval || rec.interval === "none") return false;
      if (rec.end_date && rec.end_date < today) return false;
      return true;
    });

    const generateRecurring = async () => {
      for (const inv of recurring) {
        const rec = inv.recurrence as any;
        const lastCreated = new Date(inv.created_at);
        const intervalDays = { weekly: 7, monthly: 30, quarterly: 90, yearly: 365 }[rec.interval as string] || 30;
        const nextDue = new Date(lastCreated.getTime() + intervalDays * 86400000);
        if (nextDue.toISOString().split("T")[0] <= today) {
          const newNum = inv.invoice_number + "-R";
          const { data: existing } = await supabase.from("company_invoices" as any)
            .select("id").eq("company_id", companyId).like("invoice_number", `${newNum}%`).limit(1);
          if (!existing?.length) {
            await supabase.from("company_invoices" as any).insert({
              company_id: companyId, invoice_number: `${newNum}${today.replace(/-/g, "")}`,
              total_amount: inv.total_amount, subtotal: inv.subtotal, vat_amount: inv.vat_amount,
              tax: inv.tax, status: "Draft",
              due_date: nextDue.toISOString().split("T")[0],
              contact_id: inv.contact_id, items: inv.items,
              recurrence: inv.recurrence,
            });
          }
        }
      }
      qc.invalidateQueries({ queryKey: ["company-invoices"] });
    };

    if (recurring.length > 0) generateRecurring();
  }, [invoices, companyId, qc]);

  const getPaymentTotal = (invoiceId: string) => allPayments.filter((p: any) => p.company_invoice_id === invoiceId).reduce((s: number, p: any) => s + Number(p.amount), 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const recurrence = form.recurrence_interval !== "none"
        ? { interval: form.recurrence_interval, end_date: form.recurrence_end_date || null }
        : null;
      const amount = Number(form.amount);
      const tax = Number(form.tax);
      const { error } = await supabase.from("company_invoices" as any).insert({
        company_id: companyId!, invoice_number: form.invoice_number,
        subtotal: amount, vat_amount: tax, total_amount: amount + tax, tax,
        status: form.status,
        due_date: form.due_date || null, contact_id: form.contact_id || null,
        recurrence,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company-invoices"] });
      setShowCreate(false);
      setForm({ invoice_number: "", amount: "", tax: "0", status: "Draft", due_date: "", contact_id: "", recurrence_interval: "none", recurrence_end_date: "" });
      toast({ title: "Invoice created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("company_invoices" as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-invoices"] }); toast({ title: "Status updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!showPayment) return;
      const { error } = await supabase.from("fb_payments").insert({
        company_id: companyId!, company_invoice_id: showPayment,
        amount: Number(paymentForm.amount), method: paymentForm.method, date: paymentForm.date,
      } as any);
      if (error) throw error;
      const inv = invoices.find((i: any) => i.id === showPayment);
      const totalPaid = getPaymentTotal(showPayment) + Number(paymentForm.amount);
      if (inv && totalPaid >= Number(inv.total_amount)) {
        await supabase.from("company_invoices" as any).update({ status: "Paid", amount_paid: totalPaid }).eq("id", showPayment);
      } else {
        await supabase.from("company_invoices" as any).update({ status: "Partial", amount_paid: totalPaid }).eq("id", showPayment);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company-invoices"] });
      qc.invalidateQueries({ queryKey: ["fb-payments"] });
      qc.invalidateQueries({ queryKey: ["fb-payments-all"] });
      setShowPayment(null);
      setPaymentForm({ amount: "", method: "bank_transfer", date: new Date().toISOString().split("T")[0] });
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkSendMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("company_invoices" as any).update({ status: "Sent" }).in("id", Array.from(selectedIds));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-invoices"] }); const c = selectedIds.size; setSelectedIds(new Set()); toast({ title: `${c} invoices marked as sent` }); },
  });

  const bulkMarkPaidMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("company_invoices" as any).update({ status: "Paid" }).in("id", ids);
      if (error) throw error;
      const paidInvoices = invoices.filter((i: any) => ids.includes(i.id));
      for (const inv of paidInvoices) {
        const alreadyPaid = getPaymentTotal(inv.id);
        const remaining = Number(inv.total_amount) - alreadyPaid;
        if (remaining > 0) {
          await supabase.from("fb_payments").insert({
            company_id: companyId!, company_invoice_id: inv.id,
            amount: remaining, method: "bulk_payment", date: new Date().toISOString().split("T")[0],
          } as any);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company-invoices"] });
      qc.invalidateQueries({ queryKey: ["fb-payments"] });
      qc.invalidateQueries({ queryKey: ["fb-payments-all"] });
      const c = selectedIds.size; setSelectedIds(new Set());
      toast({ title: `${c} invoices marked as paid` });
    },
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("company_invoices" as any).update({ status: "Archived" }).in("id", Array.from(selectedIds));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-invoices"] }); const c = selectedIds.size; setSelectedIds(new Set()); toast({ title: `${c} invoices archived` }); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("company_invoices" as any).delete().in("id", Array.from(selectedIds));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company-invoices"] }); const c = selectedIds.size; setSelectedIds(new Set()); toast({ title: `${c} invoices deleted` }); },
  });

  const filtered = invoices.filter((inv: any) => {
    const matchesSearch = inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
      inv.fb_contacts?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((i: any) => i.id)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Invoices</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" />New Invoice
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Sent">Sent</SelectItem>
            <SelectItem value="Paid">Paid</SelectItem>
            <SelectItem value="Partial">Partial</SelectItem>
            <SelectItem value="Overdue">Overdue</SelectItem>
            <SelectItem value="Archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        {selectedIds.size > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => bulkSendMutation.mutate()}>
              <Send className="h-4 w-4 mr-1" />Send ({selectedIds.size})
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast({ title: "PDF export coming soon" })}>
              <FileDown className="h-4 w-4 mr-1" />Export
            </Button>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => bulkMarkPaidMutation.mutate()}>
              <CheckCircle className="h-4 w-4 mr-1" />Paid ({selectedIds.size})
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkArchiveMutation.mutate()}>
              <Archive className="h-4 w-4 mr-1" />Archive
            </Button>
            <Button size="sm" variant="destructive" onClick={() => bulkDeleteMutation.mutate()}>
              <Trash2 className="h-4 w-4 mr-1" />Delete
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 w-10"><Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} /></th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice #</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Paid</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Due Date</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No invoices found</td></tr>
            ) : filtered.map((inv: any) => {
              const paid = getPaymentTotal(inv.id);
              const remaining = Number(inv.total_amount) - paid;
              const rec = inv.recurrence as any;
              return (
                <tr key={inv.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`../invoices/${inv.id}`)}>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}><Checkbox checked={selectedIds.has(inv.id)} onCheckedChange={() => toggleSelect(inv.id)} /></td>
                  <td className="px-4 py-3 font-medium text-blue-600">
                    {inv.invoice_number}
                    {rec?.interval && rec.interval !== "none" && (
                      <RefreshCw className="inline h-3 w-3 ml-1 text-muted-foreground" aria-label={`Recurring: ${rec.interval}`} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground">{inv.fb_contacts?.name || "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{fmt(Number(inv.total_amount))}</td>
                  <td className="px-4 py-3 text-right text-green-600">{paid > 0 ? fmt(paid) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.due_date || "—"}</td>
                  <td className="px-4 py-3"><Badge variant="secondary" className={statusColors[inv.status] || ""}>{inv.status}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {inv.status === "Draft" && (
                          <DropdownMenuItem onClick={() => statusMutation.mutate({ id: inv.id, status: "Sent" })}><Send className="h-4 w-4 mr-2" />Mark as Sent</DropdownMenuItem>
                        )}
                        {!["Paid", "Archived"].includes(inv.status) && (
                          <>
                            <DropdownMenuItem onClick={() => { setShowPayment(inv.id); setPaymentForm(f => ({ ...f, amount: remaining.toString() })); }}>
                              <CheckCircle className="h-4 w-4 mr-2" />Record Payment
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => statusMutation.mutate({ id: inv.id, status: "Paid" })}>Mark as Paid</DropdownMenuItem>
                          </>
                        )}
                        {inv.status !== "Archived" && (
                          <DropdownMenuItem onClick={() => statusMutation.mutate({ id: inv.id, status: "Archived" })}><Archive className="h-4 w-4 mr-2" />Archive</DropdownMenuItem>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Recurrence</Label>
                <Select value={form.recurrence_interval} onValueChange={v => setForm(f => ({ ...f, recurrence_interval: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.recurrence_interval !== "none" && (
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={form.recurrence_end_date} onChange={e => setForm(f => ({ ...f, recurrence_end_date: e.target.value }))} />
                </div>
              )}
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.invoice_number || !form.amount} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">Create Invoice</Button>
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
            <Button onClick={() => paymentMutation.mutate()} disabled={!paymentForm.amount} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">Record Payment</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBInvoiceList;

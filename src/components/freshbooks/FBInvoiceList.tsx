import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-purple-100 text-purple-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const FBInvoiceList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ invoice_number: "", amount: "", tax: "0", status: "draft", due_date: "", contact_id: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["fb-invoices", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("fb_invoices")
        .select("*, fb_contacts(name)")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false });
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

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_invoices").insert({
        company_id: companyId!,
        invoice_number: form.invoice_number,
        amount: Number(form.amount),
        tax: Number(form.tax),
        status: form.status,
        due_date: form.due_date || null,
        contact_id: form.contact_id || null,
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

  const filtered = invoices.filter((inv: any) =>
    inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    inv.fb_contacts?.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Invoices</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]">
          <Plus className="h-4 w-4 mr-2" />New Invoice
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(0,0%,53%)]" />
        <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(0,0%,90%)] bg-[hsl(0,0%,98%)]">
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Invoice #</th>
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Client</th>
              <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Amount</th>
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Due Date</th>
              <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No invoices found</td></tr>
            ) : filtered.map((inv: any) => (
              <tr key={inv.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)] transition-colors">
                <td className="px-4 py-3 font-medium text-[hsl(211,100%,43%)]">{inv.invoice_number}</td>
                <td className="px-4 py-3 text-[hsl(0,0%,29%)]">{inv.fb_contacts?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-medium text-[hsl(0,0%,29%)]">R {Number(inv.amount).toLocaleString()}</td>
                <td className="px-4 py-3 text-[hsl(0,0%,53%)]">{inv.due_date || "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={statusColors[inv.status] || ""}>{inv.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  );
};

export default FBInvoiceList;

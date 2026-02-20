import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Upload, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const EXPENSE_CATEGORIES = ["Travel", "Supplies", "Equipment", "Fuel", "Office", "Meals", "Accommodation", "Subcontractor", "General"];

const FBExpensesList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ category: "General", amount: "", vendor: "", notes: "", date: new Date().toISOString().split("T")[0] });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["fb-expenses", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_expenses").select("*").eq("company_id", companyId!).order("date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      setUploading(true);
      let receipt_url: string | null = null;

      if (receiptFile) {
        const ext = receiptFile.name.split(".").pop();
        const path = `${companyId}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("expense-receipts").upload(path, receiptFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("expense-receipts").getPublicUrl(path);
        receipt_url = urlData.publicUrl;
      }

      const { error } = await supabase.from("fb_expenses").insert({
        company_id: companyId!, category: form.category, amount: Number(form.amount),
        vendor: form.vendor || null, notes: form.notes || null, date: form.date,
        receipt_url,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-expenses"] });
      setShowCreate(false); setReceiptFile(null); setUploading(false);
      toast({ title: "Expense recorded" });
    },
    onError: (e: any) => { setUploading(false); toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const filtered = expenses.filter((e: any) => e.vendor?.toLowerCase().includes(search.toLowerCase()) || e.category?.toLowerCase().includes(search.toLowerCase()));
  const total = filtered.reduce((s: number, e: any) => s + Number(e.amount), 0);

  // Category totals
  const categoryTotals = new Map<string, number>();
  filtered.forEach((e: any) => categoryTotals.set(e.category, (categoryTotals.get(e.category) || 0) + Number(e.amount)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Expenses</h2>
          <p className="text-sm text-[hsl(0,0%,53%)]">Total: R {total.toLocaleString()}</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]"><Plus className="h-4 w-4 mr-2" />New Expense</Button>
      </div>

      {/* Category summary pills */}
      {categoryTotals.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from(categoryTotals.entries()).map(([cat, amt]) => (
            <Badge key={cat} variant="secondary" className="bg-[hsl(0,0%,96%)] text-[hsl(0,0%,29%)]">
              {cat}: R {amt.toLocaleString()}
            </Badge>
          ))}
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(0,0%,53%)]" />
        <Input placeholder="Search expenses..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-[hsl(0,0%,98%)]">
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Date</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Category</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Vendor</th>
            <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Amount</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Receipt</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No expenses</td></tr>
            : filtered.map((e: any) => (
              <tr key={e.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)]">
                <td className="px-4 py-3 text-[hsl(0,0%,53%)]">{e.date}</td>
                <td className="px-4 py-3"><Badge variant="secondary">{e.category}</Badge></td>
                <td className="px-4 py-3">{e.vendor || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">R {Number(e.amount).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {e.receipt_url ? (
                    <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[hsl(211,100%,43%)] hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="h-3.5 w-3.5" />View
                    </a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            </div>
            <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <div>
              <Label>Receipt</Label>
              <div className="mt-1">
                <label className="flex items-center gap-2 cursor-pointer border border-dashed border-[hsl(0,0%,80%)] rounded-lg p-3 hover:bg-[hsl(0,0%,98%)] transition-colors">
                  <Upload className="h-4 w-4 text-[hsl(0,0%,53%)]" />
                  <span className="text-sm text-[hsl(0,0%,53%)]">{receiptFile ? receiptFile.name : "Upload receipt image"}</span>
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setReceiptFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.amount || uploading} className="w-full bg-[hsl(211,100%,43%)]">
              {uploading ? "Uploading..." : "Save Expense"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBExpensesList;

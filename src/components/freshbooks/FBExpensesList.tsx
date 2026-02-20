import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const FBExpensesList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ category: "General", amount: "", vendor: "", notes: "", date: new Date().toISOString().split("T")[0] });
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
      const { error } = await supabase.from("fb_expenses").insert({ company_id: companyId!, ...form, amount: Number(form.amount) });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-expenses"] }); setShowCreate(false); toast({ title: "Expense recorded" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = expenses.filter((e: any) => e.vendor?.toLowerCase().includes(search.toLowerCase()) || e.category?.toLowerCase().includes(search.toLowerCase()));
  const total = filtered.reduce((s: number, e: any) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Expenses</h2>
          <p className="text-sm text-[hsl(0,0%,53%)]">Total: R {total.toLocaleString()}</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]"><Plus className="h-4 w-4 mr-2" />New Expense</Button>
      </div>
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
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No expenses</td></tr>
            : filtered.map((e: any) => (
              <tr key={e.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)]">
                <td className="px-4 py-3 text-[hsl(0,0%,53%)]">{e.date}</td>
                <td className="px-4 py-3">{e.category}</td>
                <td className="px-4 py-3">{e.vendor || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">R {Number(e.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Category</Label><Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            </div>
            <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.amount} className="w-full bg-[hsl(211,100%,43%)]">Save Expense</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBExpensesList;

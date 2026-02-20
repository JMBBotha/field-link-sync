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
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-purple-100 text-purple-700",
  accepted: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
};

const FBEstimatesList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ estimate_number: "", amount: "", tax: "0" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["fb-estimates", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_estimates").select("*, fb_contacts(name)").eq("company_id", companyId!).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_estimates").insert({
        company_id: companyId!, estimate_number: form.estimate_number, amount: Number(form.amount), tax: Number(form.tax),
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-estimates"] }); setShowCreate(false); toast({ title: "Estimate created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = estimates.filter((e: any) => e.estimate_number?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Estimates</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]"><Plus className="h-4 w-4 mr-2" />New Estimate</Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(0,0%,53%)]" />
        <Input placeholder="Search estimates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-[hsl(0,0%,98%)]">
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Estimate #</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Client</th>
            <th className="text-right px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Amount</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Status</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No estimates</td></tr>
            : filtered.map((e: any) => (
              <tr key={e.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)]">
                <td className="px-4 py-3 font-medium text-[hsl(211,100%,43%)]">{e.estimate_number}</td>
                <td className="px-4 py-3">{e.fb_contacts?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">R {Number(e.amount).toLocaleString()}</td>
                <td className="px-4 py-3"><Badge variant="secondary" className={statusColors[e.status] || ""}>{e.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Estimate</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Estimate Number</Label><Input value={form.estimate_number} onChange={e => setForm(f => ({ ...f, estimate_number: e.target.value }))} placeholder="EST-001" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Tax</Label><Input type="number" value={form.tax} onChange={e => setForm(f => ({ ...f, tax: e.target.value }))} /></div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.estimate_number} className="w-full bg-[hsl(211,100%,43%)]">Create Estimate</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBEstimatesList;

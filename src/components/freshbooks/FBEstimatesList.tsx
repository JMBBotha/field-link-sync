import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Send, Eye, Edit, ArrowRightLeft, MoreHorizontal, Archive, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-purple-100 text-purple-700",
  accepted: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
  archived: "bg-yellow-100 text-yellow-700",
};

const FBEstimatesList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("fb_estimates").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-estimates"] }); toast({ title: "Status updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_estimates").update({ status: "archived" }).in("id", Array.from(selectedIds));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-estimates"] }); const c = selectedIds.size; setSelectedIds(new Set()); toast({ title: `${c} estimates archived` }); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_estimates").delete().in("id", Array.from(selectedIds));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-estimates"] }); const c = selectedIds.size; setSelectedIds(new Set()); toast({ title: `${c} estimates deleted` }); },
  });

  const convertToInvoice = async (estimate: any) => {
    const invNum = estimate.estimate_number.replace("EST", "INV");
    const { error } = await supabase.from("fb_invoices").insert({
      company_id: companyId!, invoice_number: invNum, amount: Number(estimate.amount),
      tax: Number(estimate.tax), status: "draft", contact_id: estimate.contact_id,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await supabase.from("fb_estimates").update({ status: "accepted" }).eq("id", estimate.id);
    qc.invalidateQueries({ queryKey: ["fb-estimates"] });
    qc.invalidateQueries({ queryKey: ["fb-invoices"] });
    toast({ title: "Converted to invoice" });
  };

  const filtered = estimates.filter((e: any) => {
    const matchesSearch = e.estimate_number?.toLowerCase().includes(search.toLowerCase()) || e.fb_contacts?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
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
        <h2 className="text-2xl font-bold text-foreground">Estimates</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-amber-500 hover:bg-amber-600 text-amber-950"><Plus className="h-4 w-4 mr-2" />New Estimate</Button>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search estimates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        {selectedIds.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkArchiveMutation.mutate()}>
              <Archive className="h-4 w-4 mr-1" />Archive ({selectedIds.size})
            </Button>
            <Button size="sm" variant="destructive" onClick={() => bulkDeleteMutation.mutate()}>
              <Trash2 className="h-4 w-4 mr-1" />Delete ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>
      <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="px-4 py-3 w-10"><Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} /></th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estimate #</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No estimates</td></tr>
            : filtered.map((e: any) => (
              <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}><Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggleSelect(e.id)} /></td>
                <td className="px-4 py-3 font-medium text-blue-600">{e.estimate_number}</td>
                <td className="px-4 py-3">{e.fb_contacts?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">{fmt(Number(e.amount))}</td>
                <td className="px-4 py-3"><Badge variant="secondary" className={statusColors[e.status] || ""}>{e.status}</Badge></td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem><Eye className="h-4 w-4 mr-2" />View</DropdownMenuItem>
                      <DropdownMenuItem><Edit className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                      {e.status === "draft" && (
                        <DropdownMenuItem onClick={() => statusMutation.mutate({ id: e.id, status: "sent" })}><Send className="h-4 w-4 mr-2" />Send</DropdownMenuItem>
                      )}
                      {!["accepted", "declined", "archived"].includes(e.status) && (
                        <DropdownMenuItem onClick={() => convertToInvoice(e)}><ArrowRightLeft className="h-4 w-4 mr-2" />Convert to Invoice</DropdownMenuItem>
                      )}
                      {e.status !== "archived" && (
                        <DropdownMenuItem onClick={() => statusMutation.mutate({ id: e.id, status: "archived" })}><Archive className="h-4 w-4 mr-2" />Archive</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
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
            <Button onClick={() => createMutation.mutate()} disabled={!form.estimate_number} className="w-full bg-amber-500 hover:bg-amber-600 text-amber-950">Create Estimate</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBEstimatesList;

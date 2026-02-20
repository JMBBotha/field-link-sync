import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, FolderKanban, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  archived: "bg-gray-100 text-gray-500",
};

const FBProjectsList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", budget: "", status: "active", client_id: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["fb-projects", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_projects").select("*, fb_contacts(name)").eq("company_id", companyId!).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["fb-contacts-for-project", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_contacts").select("id, name").eq("company_id", companyId!).order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_projects").insert({
        company_id: companyId!, name: form.name, budget: Number(form.budget) || 0,
        status: form.status, client_id: form.client_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-projects"] }); setShowCreate(false); toast({ title: "Project created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = projects.filter((p: any) => p.name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Projects</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]"><Plus className="h-4 w-4 mr-2" />New Project</Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(0,0%,53%)]" />
        <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? <p className="text-[hsl(0,0%,53%)]">Loading...</p>
        : filtered.length === 0 ? <p className="text-[hsl(0,0%,53%)]">No projects</p>
        : filtered.map((p: any) => (
          <div key={p.id} className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-[hsl(211,100%,43%)]" />
                <h3 className="font-semibold text-[hsl(0,0%,29%)]">{p.name}</h3>
              </div>
              <Badge variant="secondary" className={statusColors[p.status] || ""}>{p.status}</Badge>
            </div>
            {p.fb_contacts?.name && <p className="text-sm text-[hsl(0,0%,53%)]">Client: {p.fb_contacts.name}</p>}
            <p className="text-sm font-medium text-[hsl(0,0%,29%)] mt-1">Budget: R {Number(p.budget).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Project Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Client</Label>
              <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{contacts.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Budget</Label><Input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name} className="w-full bg-[hsl(211,100%,43%)]">Create Project</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBProjectsList;

import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, FolderKanban, Search, ChevronDown, ChevronUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const statusColors: Record<string, string> = {
  active: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  on_hold: "bg-gray-100 text-gray-500",
  archived: "bg-gray-100 text-gray-500",
};

const FBProjectsList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const { data: timeEntries = [] } = useQuery({
    queryKey: ["fb-time-for-projects", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_time_entries").select("project_id, duration, billable").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: expensesList = [] } = useQuery({
    queryKey: ["fb-expenses-for-projects", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_expenses").select("amount").eq("company_id", companyId!);
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("fb_projects").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb-projects"] }),
  });

  const getProjectHours = (projectId: string) => {
    return timeEntries.filter((t: any) => t.project_id === projectId).reduce((sum: number, t: any) => {
      const dur = String(t.duration || "");
      const hMatch = dur.match(/(\d+)\s*hour/);
      const mMatch = dur.match(/(\d+)\s*min/);
      return sum + (hMatch ? Number(hMatch[1]) : 0) + (mMatch ? Number(mMatch[1]) / 60 : 0);
    }, 0);
  };

  const filtered = projects.filter((p: any) => p.name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Projects</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />New Project</Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="space-y-3">
        {isLoading ? <p className="text-muted-foreground">Loading...</p>
        : filtered.length === 0 ? <p className="text-muted-foreground">No projects</p>
        : filtered.map((p: any) => {
          const hours = getProjectHours(p.id);
          const budget = Number(p.budget) || 0;
          const spent = hours * 450;
          const utilization = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
          const isExpanded = expandedId === p.id;

          return (
            <Collapsible key={p.id} open={isExpanded} onOpenChange={() => setExpandedId(isExpanded ? null : p.id)}>
              <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
                <CollapsibleTrigger asChild>
                  <div className="p-5 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <FolderKanban className="h-5 w-5 text-amber-500" />
                        <h3 className="font-semibold text-foreground">{p.name}</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={statusColors[p.status] || "bg-gray-100 text-gray-500"}>{p.status}</Badge>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {p.fb_contacts?.name && <span className="text-muted-foreground">Client: {p.fb_contacts.name}</span>}
                      <span className="font-medium text-foreground">Budget: {fmt(budget)}</span>
                      <span className="text-muted-foreground">{hours.toFixed(1)}h logged</span>
                    </div>
                    {budget > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Spent: {fmt(spent)} / Budget: {fmt(budget)}</span>
                          <span>{Math.round(utilization)}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${utilization}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="border-t border-border p-5 space-y-4">
                    <div className="flex gap-2">
                      <Select value={p.status} onValueChange={v => updateMutation.mutate({ id: p.id, status: v })}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="on_hold">On Hold</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Hours</p>
                        <p className="text-lg font-bold text-foreground">{hours.toFixed(1)}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Cost (est)</p>
                        <p className="text-lg font-bold text-foreground">{fmt(spent)}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Remaining</p>
                        <p className="text-lg font-bold text-foreground">{fmt(Math.max(0, budget - spent))}</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
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
            <div><Label>Budget (R)</Label><Input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name} className="w-full bg-amber-500 hover:bg-amber-600 text-white">Create Project</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBProjectsList;

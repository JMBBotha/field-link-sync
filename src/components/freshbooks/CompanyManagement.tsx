import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, ArrowRight, Search, Pause, Play, Archive, Trash2, MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

type CompanyStatus = "active" | "on_hold" | "archived";

const statusConfig: Record<CompanyStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  active: { label: "Active", variant: "default", className: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30" },
  on_hold: { label: "On Hold", variant: "secondary", className: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30" },
  archived: { label: "Archived", variant: "outline", className: "bg-muted text-muted-foreground border-border" },
};

const CompanyManagement = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CompanyStatus>("all");
  const [form, setForm] = useState({ name: "", slug: "" });
  const [confirmAction, setConfirmAction] = useState<{ company: any; action: CompanyStatus | "delete" } | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["all-companies"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { data: company, error: companyErr } = await supabase
        .from("companies")
        .insert({ name: form.name, slug: form.slug || form.name.toLowerCase().replace(/\s+/g, "-") })
        .select()
        .single();
      if (companyErr) throw companyErr;
      const { error: memberErr } = await supabase
        .from("company_members")
        .insert({ user_id: user.id, company_id: company.id, role: "admin" });
      if (memberErr) throw memberErr;
      return company;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-companies"] });
      setShowCreate(false);
      setForm({ name: "", slug: "" });
      toast({ title: "Company created successfully" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CompanyStatus }) => {
      const { error } = await supabase.from("companies").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ["all-companies"] });
      setConfirmAction(null);
      const labels: Record<string, string> = { active: "reactivated", on_hold: "put on hold", archived: "archived" };
      toast({ title: `Company ${labels[status]}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-companies"] });
      setConfirmAction(null);
      toast({ title: "Company deleted permanently" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.action === "delete") {
      deleteMutation.mutate(confirmAction.company.id);
    } else {
      statusMutation.mutate({ id: confirmAction.company.id, status: confirmAction.action });
    }
  };

  const filtered = companies.filter((c: any) => {
    const matchesSearch = c.name?.toLowerCase().includes(search.toLowerCase()) || c.slug?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || (c.status || "active") === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const confirmMessages: Record<string, { title: string; desc: string; buttonLabel: string; variant: "default" | "destructive" }> = {
    on_hold: { title: "Put Company On Hold", desc: "This company's users will still be able to log in but will see a notice. You can reactivate anytime.", buttonLabel: "Put On Hold", variant: "default" },
    archived: { title: "Archive Company", desc: "This will hide the company from active views. Data is preserved and can be restored by reactivating.", buttonLabel: "Archive", variant: "destructive" },
    active: { title: "Reactivate Company", desc: "This will restore the company to active status.", buttonLabel: "Reactivate", variant: "default" },
    delete: { title: "Delete Company Permanently", desc: "This will permanently delete this company and all associated data. This action cannot be undone.", buttonLabel: "Delete Forever", variant: "destructive" },
  };

  const counts = {
    all: companies.length,
    active: companies.filter((c: any) => (c.status || "active") === "active").length,
    on_hold: companies.filter((c: any) => c.status === "on_hold").length,
    archived: companies.filter((c: any) => c.status === "archived").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Company Management</h2>
          <p className="text-sm text-muted-foreground">{companies.length} companies onboarded</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]">
          <Plus className="h-4 w-4 mr-2" />Onboard Company
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-1.5">
          {(["all", "active", "on_hold", "archived"] as const).map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className={statusFilter === s ? "bg-primary" : ""}
            >
              {s === "all" ? "All" : s === "on_hold" ? "On Hold" : s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="ml-1.5 text-xs opacity-70">({counts[s]})</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Created</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No companies found</td></tr>
            ) : filtered.map((c: any) => {
              const status: CompanyStatus = c.status || "active";
              const cfg = statusConfig[status];
              return (
                <tr key={c.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-[hsl(211,100%,43%)]/10 flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-[hsl(211,100%,43%)]" />
                      </div>
                      <span className={`font-medium ${status === "archived" ? "text-muted-foreground line-through" : "text-foreground"}`}>{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={cfg.variant} className={cfg.className}>
                      {cfg.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{c.slug || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {status === "active" && (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/client/${c.id}/dashboard`)}>
                          Enter <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {status !== "active" && (
                            <DropdownMenuItem onClick={() => setConfirmAction({ company: c, action: "active" })}>
                              <Play className="h-4 w-4 mr-2 text-[hsl(var(--success))]" />Reactivate
                            </DropdownMenuItem>
                          )}
                          {status === "active" && (
                            <DropdownMenuItem onClick={() => setConfirmAction({ company: c, action: "on_hold" })}>
                              <Pause className="h-4 w-4 mr-2 text-[hsl(var(--warning))]" />Put On Hold
                            </DropdownMenuItem>
                          )}
                          {status !== "archived" && (
                            <DropdownMenuItem onClick={() => setConfirmAction({ company: c, action: "archived" })}>
                              <Archive className="h-4 w-4 mr-2" />Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmAction({ company: c, action: "delete" })}>
                            <Trash2 className="h-4 w-4 mr-2" />Delete Permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Onboard New Company</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Company Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme HVAC" /></div>
            <div><Label>URL Slug</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="acme-hvac" /></div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} className="w-full bg-[hsl(211,100%,43%)]">
              {createMutation.isPending ? "Creating..." : "Create Company"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction ? confirmMessages[confirmAction.action].title : ""}</DialogTitle>
            <DialogDescription>
              {confirmAction && (
                <>
                  <span className="font-medium text-foreground">{confirmAction.company.name}</span>
                  <br /><br />
                  {confirmMessages[confirmAction.action].desc}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant={confirmAction ? confirmMessages[confirmAction.action].variant : "default"}
              onClick={handleConfirm}
              disabled={statusMutation.isPending || deleteMutation.isPending}
            >
              {statusMutation.isPending || deleteMutation.isPending ? "Processing..." : confirmAction ? confirmMessages[confirmAction.action].buttonLabel : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CompanyManagement;

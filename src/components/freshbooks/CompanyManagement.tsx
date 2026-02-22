import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Building2, ArrowRight, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const CompanyManagement = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", slug: "" });
  const navigate = useNavigate();
  const { toast } = useToast();
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Create company
      const { data: company, error: companyErr } = await supabase
        .from("companies")
        .insert({ name: form.name, slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-') })
        .select()
        .single();
      if (companyErr) throw companyErr;

      // Add creator as admin member
      const { error: memberErr } = await supabase
        .from("company_members")
        .insert({ user_id: session.user.id, company_id: company.id, role: "admin" });
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

  const filtered = companies.filter((c: any) =>
    c.name?.toLowerCase().includes(search.toLowerCase()) || c.slug?.toLowerCase().includes(search.toLowerCase())
  );

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

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="bg-card rounded-lg shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No companies found</td></tr>
            ) : filtered.map((c: any) => (
              <tr key={c.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-[hsl(211,100%,43%)]/10 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-[hsl(211,100%,43%)]" />
                    </div>
                    <span className="font-medium text-foreground">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.slug || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/client/${c.id}/dashboard`)}>
                    Enter Dashboard <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  );
};

export default CompanyManagement;

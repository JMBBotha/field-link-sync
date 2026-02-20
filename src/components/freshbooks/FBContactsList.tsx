import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const FBContactsList = () => {
  const { companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company_name: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["fb-contacts", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_contacts").select("*").eq("company_id", companyId!).order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fb_contacts").insert({ company_id: companyId!, ...form });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-contacts"] }); setShowCreate(false);
      setForm({ name: "", email: "", phone: "", company_name: "" }); toast({ title: "Client added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = contacts.filter((c: any) => c.name?.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Clients</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Plus className="h-4 w-4 mr-2" />New Client</Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? <p className="text-muted-foreground">Loading...</p>
        : filtered.length === 0 ? <p className="text-muted-foreground">No clients found</p>
        : filtered.map((c: any) => (
          <div key={c.id} className="bg-card rounded-lg shadow-sm border border-border p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{c.name}</p>
                {c.company_name && <p className="text-xs text-muted-foreground">{c.company_name}</p>}
                {c.email && <p className="text-xs text-blue-600 mt-1">{c.email}</p>}
                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Client</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Company</Label><Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">Add Client</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBContactsList;

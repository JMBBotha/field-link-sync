import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Building2, Pencil, Trash2 } from "lucide-react";

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

interface SupplierManagerProps {
  selectedSupplierId: string | null;
  onSelectSupplier: (id: string) => void;
}

const SupplierManager = ({ selectedSupplierId, onSelectSupplier }: SupplierManagerProps) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        website: website || null,
        updated_at: new Date().toISOString(),
      };

      if (editingSupplier) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editingSupplier.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("suppliers").insert(payload).select("id").single();
        if (error) throw error;
        onSelectSupplier(data.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast({ title: editingSupplier ? "Supplier updated" : "Supplier added" });
      closeForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast({ title: "Supplier removed" });
    },
  });

  const openForm = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setName(supplier.name);
      setContactName(supplier.contact_name || "");
      setContactEmail(supplier.contact_email || "");
      setContactPhone(supplier.contact_phone || "");
      setWebsite(supplier.website || "");
    } else {
      setEditingSupplier(null);
      setName("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setWebsite("");
    }
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingSupplier(null);
  };

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Suppliers
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => openForm()} className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Add Supplier
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suppliers yet. Add one to get started.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suppliers.map((s) => (
                <div key={s.id} className="flex items-center gap-1">
                  <Badge
                    variant={selectedSupplierId === s.id ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => onSelectSupplier(s.id)}
                  >
                    {s.name}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => openForm(s)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Supplier Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Livance / Midea" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact Person</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
              <div>
                <Label>Website</Label>
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={closeForm}>Cancel</Button>
              <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={!name || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Add"}
              </Button>
            </div>
            {editingSupplier && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => { deleteMutation.mutate(editingSupplier.id); closeForm(); }}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Remove Supplier
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SupplierManager;

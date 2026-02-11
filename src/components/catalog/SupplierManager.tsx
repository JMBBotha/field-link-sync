import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Building2, Pencil, Trash2, Wrench, Snowflake, Package } from "lucide-react";

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
  supplier_type: string;
}

interface SupplierManagerProps {
  selectedSupplierId: string | null;
  onSelectSupplier: (id: string) => void;
  supplierTypeFilter?: string;
  activeTypeFilter?: string;
}

const SupplierManager = ({ selectedSupplierId, onSelectSupplier, supplierTypeFilter, activeTypeFilter }: SupplierManagerProps) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [isConsumables, setIsConsumables] = useState(false);
  const [deleteAllSupplierId, setDeleteAllSupplierId] = useState<string | null>(null);
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
      return data as unknown as Supplier[];
    },
  });

  // Product counts per supplier
  const { data: productCounts = {} } = useQuery({
    queryKey: ["supplier-product-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("supplier_id")
        .eq("archived", false);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        counts[row.supplier_id] = (counts[row.supplier_id] || 0) + 1;
      });
      return counts;
    },
  });

  const displayedSuppliers = supplierTypeFilter
    ? suppliers.filter(s => s.supplier_type === supplierTypeFilter)
    : suppliers;

  // Auto-create default supplier if none exist
  useEffect(() => {
    if (!isLoading && suppliers.length === 0) {
      const createDefault = async () => {
        const { data, error } = await supabase
          .from("suppliers")
          .insert({ name: "Midea - Livance" })
          .select("id")
          .single();
        if (!error && data) {
          queryClient.invalidateQueries({ queryKey: ["suppliers"] });
          onSelectSupplier(data.id);
        }
      };
      createDefault();
    } else if (!isLoading && suppliers.length > 0 && !selectedSupplierId) {
      onSelectSupplier(suppliers[0].id);
    }
  }, [isLoading, suppliers.length]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        website: website || null,
        supplier_type: isConsumables ? "consumables" : "ac_units",
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
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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

  const deleteAllProductsMutation = useMutation({
    mutationFn: async (supplierId: string) => {
      const { error } = await (supabase.from("supplier_products") as any)
        .delete()
        .eq("supplier_id", supplierId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
      queryClient.invalidateQueries({ queryKey: ["consumable-products"] });
      toast({ title: "All products deleted for this supplier" });
      setDeleteAllSupplierId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openForm = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setName(supplier.name);
      setContactName(supplier.contact_name || "");
      setContactEmail(supplier.contact_email || "");
      setContactPhone(supplier.contact_phone || "");
      setWebsite(supplier.website || "");
      setIsConsumables(supplier.supplier_type === "consumables");
    } else {
      setEditingSupplier(null);
      setName("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setWebsite("");
      setIsConsumables(activeTypeFilter === "consumables");
    }
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); setEditingSupplier(null); };

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
            <p className="text-sm text-muted-foreground">Creating default supplier...</p>
          ) : displayedSuppliers.length === 0 && supplierTypeFilter ? (
            <div className="text-center py-6 space-y-3">
              <Wrench className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No {supplierTypeFilter === "consumables" ? "consumables" : "AC unit"} suppliers yet.
                <br />
                Click <strong>+ Add Supplier</strong> and enable the <strong>'Consumables Supplier'</strong> toggle to get started.
              </p>
              <Button size="sm" variant="outline" onClick={() => openForm()} className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add Supplier
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {displayedSuppliers.map((s) => {
                const count = productCounts[s.id] || 0;
                return (
                  <div key={s.id} className="flex items-center gap-1">
                    <Badge
                      variant={selectedSupplierId === s.id ? "default" : "outline"}
                      className={`cursor-pointer gap-1 ${
                        s.supplier_type === "consumables"
                          ? selectedSupplierId === s.id
                            ? "bg-orange-600 hover:bg-orange-700 border-orange-600"
                            : "border-orange-500/50 text-orange-600"
                          : ""
                      }`}
                      onClick={() => onSelectSupplier(s.id)}
                    >
                      {s.supplier_type === "consumables"
                        ? <Wrench className="h-3 w-3" />
                        : <Snowflake className="h-3 w-3" />}
                      {s.name}
                      <span className="ml-1 bg-background/20 text-[10px] px-1 rounded-full">{count}</span>
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openForm(s)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {count > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-destructive hover:text-destructive"
                        onClick={() => setDeleteAllSupplierId(s.id)}
                        title="Delete all products"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
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
            <div className="flex items-center justify-between py-2 px-1 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-orange-500" />
                <Label className="text-sm">Consumables Supplier</Label>
              </div>
              <Switch checked={isConsumables} onCheckedChange={setIsConsumables} />
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Enable for suppliers that sell piping, cable, insulation, brackets, fittings, gas, tools etc.
            </p>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={closeForm}>Cancel</Button>
              <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={!name || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Add"}
              </Button>
            </div>
            {editingSupplier && (
              <Button variant="destructive" size="sm" className="w-full" onClick={() => { deleteMutation.mutate(editingSupplier.id); closeForm(); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Remove Supplier
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteAllSupplierId} onOpenChange={(o) => !o && setDeleteAllSupplierId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all products?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {deleteAllSupplierId ? (productCounts[deleteAllSupplierId] || 0) : 0} products
              for supplier "{suppliers.find(s => s.id === deleteAllSupplierId)?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAllSupplierId && deleteAllProductsMutation.mutate(deleteAllSupplierId)}
            >
              {deleteAllProductsMutation.isPending ? "Deleting..." : "Delete All Products"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SupplierManager;

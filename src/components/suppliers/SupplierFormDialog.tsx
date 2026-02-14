import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Wrench, Snowflake } from "lucide-react";

interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string | null;
}

const SupplierFormDialog = ({ open, onOpenChange, supplierId }: SupplierFormDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!supplierId;

  const [form, setForm] = useState({
    name: "",
    company_name: "",
    trading_name: "",
    registration_number: "",
    vat_number: "",
    website: "",
    physical_address: "",
    postal_address: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    notes: "",
    isConsumables: false,
  });

  const { data: supplier } = useQuery({
    queryKey: ["supplier-detail", supplierId],
    queryFn: async () => {
      if (!supplierId) return null;
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("id", supplierId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!supplierId && open,
  });

  useEffect(() => {
    if (supplier && isEditing) {
      setForm({
        name: supplier.name || "",
        company_name: supplier.company_name || supplier.name || "",
        trading_name: supplier.trading_name || "",
        registration_number: supplier.registration_number || "",
        vat_number: supplier.vat_number || "",
        website: supplier.website || "",
        physical_address: supplier.physical_address || "",
        postal_address: supplier.postal_address || "",
        contact_name: supplier.contact_name || "",
        contact_email: supplier.contact_email || "",
        contact_phone: supplier.contact_phone || "",
        notes: supplier.notes || "",
        isConsumables: supplier.supplier_type === "consumables",
      });
    } else if (!isEditing && open) {
      setForm({
        name: "", company_name: "", trading_name: "", registration_number: "",
        vat_number: "", website: "", physical_address: "", postal_address: "",
        contact_name: "", contact_email: "", contact_phone: "", notes: "",
        isConsumables: false,
      });
    }
  }, [supplier, isEditing, open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: form.company_name || form.name,
        company_name: form.company_name || null,
        trading_name: form.trading_name || null,
        registration_number: form.registration_number || null,
        vat_number: form.vat_number || null,
        website: form.website || null,
        physical_address: form.physical_address || null,
        postal_address: form.postal_address || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        notes: form.notes || null,
        supplier_type: form.isConsumables ? "consumables" : "ac_units",
        updated_at: new Date().toISOString(),
      };
      if (isEditing) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", supplierId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-suppliers-list"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-detail", supplierId] });
      toast({ title: isEditing ? "Supplier updated" : "Supplier added" });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const set = (key: string, val: string | boolean) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Company Name *</Label>
              <Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="Acme HVAC Ltd" />
            </div>
            <div>
              <Label>Trading Name</Label>
              <Input value={form.trading_name} onChange={(e) => set("trading_name", e.target.value)} placeholder="Acme" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Registration Number</Label>
              <Input value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} />
            </div>
            <div>
              <Label>VAT Number</Label>
              <Input value={form.vat_number} onChange={(e) => set("vat_number", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Website</Label>
            <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label>Physical Address</Label>
            <Textarea value={form.physical_address} onChange={(e) => set("physical_address", e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Postal Address</Label>
            <Textarea value={form.postal_address} onChange={(e) => set("postal_address", e.target.value)} rows={2} />
          </div>

          <div className="border-t pt-3">
            <p className="text-sm font-medium mb-2">Primary Contact (Legacy)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </div>

          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              {form.isConsumables ? <Wrench className="h-4 w-4 text-orange-500" /> : <Snowflake className="h-4 w-4 text-primary" />}
              <Label className="text-sm">Consumables Supplier</Label>
            </div>
            <Switch checked={form.isConsumables} onCheckedChange={(v) => set("isConsumables", v)} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="flex-1"
              onClick={() => saveMutation.mutate()}
              disabled={!form.company_name || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : isEditing ? "Update" : "Add Supplier"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierFormDialog;

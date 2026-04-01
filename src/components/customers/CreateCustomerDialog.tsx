import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCheckDuplicates, type DuplicateMatch } from "@/hooks/useCustomerSearch";
import { Loader2, AlertTriangle, User, Phone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: { id: string; first_name: string; last_name: string; phone: string }) => void;
  initialName?: string;
}

const CreateCustomerDialog = ({ open, onOpenChange, onCreated, initialName }: CreateCustomerDialogProps) => {
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const { checkDuplicates, checking } = useCheckDuplicates();
  const { toast } = useToast();

  const nameParts = (initialName || "").split(" ");
  const [form, setForm] = useState({
    first_name: nameParts[0] || "",
    last_name: nameParts.slice(1).join(" ") || "",
    company_name: "",
    is_company: false,
    phone: "",
    secondary_phone: "",
    email: "",
    primary_address_line1: "",
    primary_address_line2: "",
    city: "",
    postal_code: "",
  });

  const handleCheckAndSave = async () => {
    // Check for duplicates first
    const matches = await checkDuplicates({
      phone: form.phone,
      email: form.email,
      firstName: form.first_name,
      lastName: form.last_name,
      address: form.primary_address_line1,
    });

    if (matches.length > 0 && !showDuplicates) {
      setDuplicates(matches);
      setShowDuplicates(true);
      return;
    }

    await saveCustomer();
  };

  const saveCustomer = async () => {
    setSaving(true);
    try {
      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const company_id = await getUserCompanyId();
      const { data, error } = await supabase
        .from("customers")
        .insert({
          first_name: form.first_name,
          company_id,
          last_name: form.last_name,
          name: `${form.first_name} ${form.last_name}`.trim(),
          company_name: form.company_name || null,
          is_company: form.is_company,
          phone: form.phone,
          secondary_phone: form.secondary_phone || null,
          email: form.email || null,
          primary_address_line1: form.primary_address_line1 || null,
          primary_address_line2: form.primary_address_line2 || null,
          city: form.city || null,
          postal_code: form.postal_code || null,
          address: [form.primary_address_line1, form.primary_address_line2, form.city, form.postal_code].filter(Boolean).join(", "),
          status: "lead",
        })
        .select("id, first_name, last_name, phone")
        .single();

      if (error) throw error;
      toast({ title: "Customer Created ✅" });
      onCreated(data);
      onOpenChange(false);
      // Reset
      setForm({ first_name: "", last_name: "", company_name: "", is_company: false, phone: "", secondary_phone: "", email: "", primary_address_line1: "", primary_address_line2: "", city: "", postal_code: "" });
      setDuplicates([]);
      setShowDuplicates(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const useExisting = (match: DuplicateMatch) => {
    onCreated({ id: match.id, first_name: match.first_name || "", last_name: match.last_name || "", phone: match.phone });
    onOpenChange(false);
    setDuplicates([]);
    setShowDuplicates(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
          <DialogDescription>Add a new customer to the database</DialogDescription>
        </DialogHeader>

        {/* Duplicate warning */}
        {showDuplicates && duplicates.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Possible existing customers found</span>
            </div>
            {duplicates.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-2 rounded-md bg-background border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.first_name} {d.last_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" />{d.phone}</span>
                    {d.primary_address_line1 && <span className="truncate"><MapPin className="h-3 w-3 inline" /> {d.primary_address_line1}</span>}
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {d.match_type === "exact_phone" ? "Phone match" : d.match_type === "exact_email" ? "Email match" : "Similar name"}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => useExisting(d)}>
                  Use this
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="w-full text-amber-700" onClick={saveCustomer}>
              Create new anyway
            </Button>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={form.is_company} onCheckedChange={(v) => setForm(prev => ({ ...prev, is_company: v }))} />
            <Label className="text-sm">This is a company</Label>
          </div>

          {form.is_company && (
            <div className="space-y-2">
              <Label>Company Name *</Label>
              <Input value={form.company_name} onChange={(e) => setForm(prev => ({ ...prev, company_name: e.target.value }))} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>First Name *</Label>
              <Input value={form.first_name} onChange={(e) => setForm(prev => ({ ...prev, first_name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={(e) => setForm(prev => ({ ...prev, last_name: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone *</Label>
              <Input value={form.phone} onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="082 123 4567" />
            </div>
            <div className="space-y-2">
              <Label>Secondary Phone</Label>
              <Input value={form.secondary_phone} onChange={(e) => setForm(prev => ({ ...prev, secondary_phone: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))} />
          </div>

          <div className="space-y-2">
            <Label>Address Line 1</Label>
            <Input value={form.primary_address_line1} onChange={(e) => setForm(prev => ({ ...prev, primary_address_line1: e.target.value }))} placeholder="123 Main Street" />
          </div>
          <div className="space-y-2">
            <Label>Address Line 2 (Unit/Flat)</Label>
            <Input value={form.primary_address_line2} onChange={(e) => setForm(prev => ({ ...prev, primary_address_line2: e.target.value }))} placeholder="Flat 3, Block B" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => setForm(prev => ({ ...prev, city: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Postal Code</Label>
              <Input value={form.postal_code} onChange={(e) => setForm(prev => ({ ...prev, postal_code: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancel</Button>
          <Button
            onClick={handleCheckAndSave}
            disabled={saving || checking || !form.first_name || !form.phone}
            className="flex-1"
          >
            {(saving || checking) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {showDuplicates ? "Create Anyway" : "Save Customer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCustomerDialog;

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatStoredAddress, locationsToCreate } from "@/lib/clientAddresses";
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
  const { user } = useAuth();
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
    vat_number: "",
    phone: "",
    secondary_phone: "",
    email: "",
    primary_address_line1: "",
    primary_address_line2: "",
    city: "",
    postal_code: "",
    home_address: "",
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
      const company_id = await getUserCompanyId(user?.id);
      const { data, error } = await supabase
        .from("customers")
        .insert({
          first_name: form.first_name,
          company_id,
          last_name: form.last_name,
          name: `${form.first_name} ${form.last_name}`.trim(),
          company_name: form.company_name.trim() || null,
          is_company: !!form.company_name.trim(),
          vat_number: form.vat_number.trim() || null,
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
      if (company_id && data?.id) {
        const rows = locationsToCreate({
          customerId: data.id,
          companyId: company_id,
          homeAddress: form.home_address,
          workAddress: formatStoredAddress({
            line1: form.primary_address_line1,
            line2: form.primary_address_line2,
            city: form.city,
            postal: form.postal_code,
          }),
        });
        if (rows.length) {
          const { error: locErr } = await supabase.from("customer_locations").insert(rows);
          if (locErr) toast({ title: "Client saved", description: "Home or work could not be stored. Add it from Edit details.", variant: "destructive" });
        }
      }
      toast({ title: "Customer Created ✅" });
      onCreated(data);
      onOpenChange(false);
      // Reset
      setForm({ first_name: "", last_name: "", company_name: "", vat_number: "", phone: "", secondary_phone: "", email: "", primary_address_line1: "", primary_address_line2: "", city: "", postal_code: "", home_address: "" });
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
                <Badge variant="outline" className="text-xs shrink-0">
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
          <div className="space-y-3">
            <p className="text-sm font-semibold">Private details</p>
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
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Company details</p>
              <p className="text-xs text-muted-foreground">Optional. Leave the company name blank for a private client. You can fill either side in later.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-company-name">Company name</Label>
              <Input id="create-company-name" data-testid="create-company-name" value={form.company_name} onChange={(e) => setForm(prev => ({ ...prev, company_name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-vat-number">VAT number</Label>
              <Input id="create-vat-number" value={form.vat_number} onChange={(e) => setForm(prev => ({ ...prev, vat_number: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Work address</p>
              <p className="text-xs text-muted-foreground">Invoices bill to this address, not the home address.</p>
            </div>
            <div className="space-y-2">
              <Label>Address line 1</Label>
              <Input value={form.primary_address_line1} onChange={(e) => setForm(prev => ({ ...prev, primary_address_line1: e.target.value }))} placeholder="123 Main Street" />
            </div>
            <div className="space-y-2">
              <Label>Address line 2 (unit / flat)</Label>
              <Input value={form.primary_address_line2} onChange={(e) => setForm(prev => ({ ...prev, primary_address_line2: e.target.value }))} placeholder="Flat 3, Block B" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm(prev => ({ ...prev, city: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Postal code</Label>
                <Input value={form.postal_code} onChange={(e) => setForm(prev => ({ ...prev, postal_code: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Home address</p>
            <Label htmlFor="create-home-address">Address</Label>
            <Input id="create-home-address" value={form.home_address} onChange={(e) => setForm(prev => ({ ...prev, home_address: e.target.value }))} placeholder="Optional" />
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

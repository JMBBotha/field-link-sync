import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Check, Mail } from "lucide-react";

interface PDFExtractReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extractedData: Record<string, string>;
  supplierId: string;
}

const FIELD_LABELS: Record<string, string> = {
  phone: "Phone Number",
  email: "Email Address",
  vat_number: "VAT Number",
  registration_number: "Registration Number",
  website: "Website",
  physical_address: "Physical Address",
};

const PDFExtractReviewModal = ({ open, onOpenChange, extractedData, supplierId }: PDFExtractReviewModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<Record<string, string>>({});
  const categorizedEmails = extractedData.categorized_emails
    ? JSON.parse(extractedData.categorized_emails) as Record<string, string>
    : null;

  useEffect(() => {
    const clean = { ...extractedData };
    delete clean.categorized_emails;
    setFields(clean);
  }, [extractedData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {};
      if (fields.phone) payload.contact_phone = fields.phone;
      if (fields.email) payload.contact_email = fields.email;
      if (fields.vat_number) payload.vat_number = fields.vat_number;
      if (fields.registration_number) payload.registration_number = fields.registration_number;
      if (fields.website) payload.website = fields.website;
      if (fields.physical_address) payload.physical_address = fields.physical_address;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase.from("suppliers").update(payload).eq("id", supplierId);
      if (error) throw error;

      // Create contacts from categorized emails
      if (categorizedEmails) {
        const contacts = Object.entries(categorizedEmails).map(([dept, email]) => ({
          supplier_id: supplierId,
          contact_name: `${dept} Contact`,
          email,
          department: dept === "General" ? "Other" : dept,
          is_primary: dept === "Sales" || Object.keys(categorizedEmails!).length === 1,
        }));
        if (contacts.length > 0) {
          await (supabase.from("supplier_contacts") as any).insert(contacts);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-detail", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["admin-suppliers-list"] });
      toast({ title: "Supplier updated from PDF data" });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const displayFields = Object.entries(fields).filter(([k]) => k in FIELD_LABELS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Extracted PDF Data
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          We found the following info in the PDF. Edit if needed, then save to update the supplier record.
        </p>
        <div className="space-y-3 mt-2">
          {displayFields.map(([key, value]) => (
            <div key={key}>
              <Label className="text-xs">{FIELD_LABELS[key]}</Label>
              <Input
                value={value}
                onChange={(e) => setFields((p) => ({ ...p, [key]: e.target.value }))}
              />
            </div>
          ))}

          {categorizedEmails && Object.keys(categorizedEmails).length > 0 && (
            <div className="border-t pt-3">
              <Label className="text-xs flex items-center gap-1 mb-2">
                <Mail className="h-3 w-3" /> Detected Email Contacts
              </Label>
              <div className="space-y-1">
                {Object.entries(categorizedEmails).map(([dept, email]) => (
                  <div key={dept} className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary" className="text-[10px]">{dept}</Badge>
                    <span className="text-muted-foreground">{email}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                These will be added as contacts for this supplier.
              </p>
            </div>
          )}

          {displayFields.length === 0 && !categorizedEmails && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No extractable data was found.
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || displayFields.length === 0}
            >
              {saveMutation.isPending ? "Saving..." : (
                <><Check className="h-4 w-4 mr-1" /> Save to Supplier</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PDFExtractReviewModal;

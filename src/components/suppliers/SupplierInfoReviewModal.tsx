import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Building2, Globe, Phone, Mail, MapPin, Plus, Trash2, Loader2,
  CheckCircle, MessageCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ExtractedSupplierInfo, ExtractedDepartment, ExtractedLocation } from "@/services/supplierInfoExtractor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  extracted: ExtractedSupplierInfo;
  onComplete: () => void;
}

const SupplierInfoReviewModal = ({ open, onOpenChange, supplierId, supplierName, extracted, onComplete }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Editable state initialized from extraction
  const [companyInfo, setCompanyInfo] = useState({
    vatNumber: extracted.vatNumber || "",
    registrationNumber: extracted.registrationNumber || "",
    website: extracted.website || "",
    mainPhone: extracted.mainPhone || "",
    mainEmail: extracted.mainEmail || "",
    mainWhatsapp: extracted.mainWhatsapp || "",
    headOfficeAddress: extracted.headOfficeAddress || "",
  });

  const [departments, setDepartments] = useState<ExtractedDepartment[]>(extracted.departments);
  const [locations, setLocations] = useState<ExtractedLocation[]>(extracted.locations);

  const setInfo = (key: string, val: string) => setCompanyInfo((p) => ({ ...p, [key]: val }));

  const removeDept = (idx: number) => setDepartments((p) => p.filter((_, i) => i !== idx));
  const removeLocation = (idx: number) => setLocations((p) => p.filter((_, i) => i !== idx));

  const addDept = () => setDepartments((p) => [...p, { department: "Other", emails: [""], phones: [""] }]);
  const addLocation = () => setLocations((p) => [...p, { city: "", phones: [""], emails: [] }]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Update supplier main info
      await (supabase.from("suppliers") as any)
        .update({
          vat_number: companyInfo.vatNumber || null,
          registration_number: companyInfo.registrationNumber || null,
          website: companyInfo.website || null,
          main_phone: companyInfo.mainPhone || null,
          main_email: companyInfo.mainEmail || null,
          main_whatsapp: companyInfo.mainWhatsapp || null,
          head_office_address: companyInfo.headOfficeAddress || null,
        })
        .eq("id", supplierId);

      // 2. Insert locations
      for (const loc of locations) {
        if (!loc.city) continue;
        const { data: inserted } = await (supabase.from("supplier_locations") as any)
          .insert({
            supplier_id: supplierId,
            location_name: loc.city,
            city: loc.city,
            address: loc.address || null,
            phone: loc.phones[0] || null,
            whatsapp: loc.whatsapp || null,
            email: loc.emails[0] || null,
          })
          .select("id")
          .single();

        // 3. Insert department contacts linked to this location
        if (inserted) {
          for (const dept of departments) {
            const deptEmailForLocation = dept.emails.find((e) =>
              e.toLowerCase().includes(loc.city.toLowerCase().slice(0, 3))
            );
            if (deptEmailForLocation || dept.phones.length > 0) {
              await (supabase.from("supplier_contacts") as any).insert({
                supplier_id: supplierId,
                location_id: inserted.id,
                department: dept.department,
                contact_name: dept.contactName || `${dept.department} Contact`,
                email: deptEmailForLocation || dept.emails[0] || null,
                phone: dept.phones[0] || null,
                whatsapp: null,
                is_primary: false,
              });
            }
          }
        }
      }

      // 4. Insert remaining department contacts without specific location
      for (const dept of departments) {
        const hasLocContacts = locations.some((loc) =>
          dept.emails.some((e) => e.toLowerCase().includes(loc.city.toLowerCase().slice(0, 3)))
        );
        if (!hasLocContacts) {
          await (supabase.from("supplier_contacts") as any).insert({
            supplier_id: supplierId,
            department: dept.department,
            contact_name: dept.contactName || `${dept.department} Contact`,
            email: dept.emails[0] || null,
            phone: dept.phones[0] || null,
            is_primary: false,
          });
        }
      }

      toast({
        title: "Supplier info saved",
        description: `${locations.length} locations and ${departments.length} departments saved.`,
      });
      onComplete();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const hasData = companyInfo.vatNumber || companyInfo.website || companyInfo.mainPhone ||
    companyInfo.mainEmail || departments.length > 0 || locations.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Supplier Information Extracted from PDF
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Review and edit the information detected in <strong>{supplierName}</strong>'s price list.
          </p>
        </DialogHeader>

        <div className="space-y-5">
          {/* Company Details */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Building2 className="h-4 w-4" /> Company Details
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">VAT Number</Label>
                <Input value={companyInfo.vatNumber} onChange={(e) => setInfo("vatNumber", e.target.value)} placeholder="e.g. 4123456789" />
              </div>
              <div>
                <Label className="text-xs">Registration Number</Label>
                <Input value={companyInfo.registrationNumber} onChange={(e) => setInfo("registrationNumber", e.target.value)} placeholder="e.g. 2001/123456/07" />
              </div>
              <div>
                <Label className="text-xs">Website</Label>
                <Input value={companyInfo.website} onChange={(e) => setInfo("website", e.target.value)} placeholder="www.example.co.za" />
              </div>
              <div>
                <Label className="text-xs">Head Office Address</Label>
                <Input value={companyInfo.headOfficeAddress} onChange={(e) => setInfo("headOfficeAddress", e.target.value)} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Main Contact */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Phone className="h-4 w-4" /> Main Contact
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={companyInfo.mainPhone} onChange={(e) => setInfo("mainPhone", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input value={companyInfo.mainEmail} onChange={(e) => setInfo("mainEmail", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">WhatsApp</Label>
                <Input value={companyInfo.mainWhatsapp} onChange={(e) => setInfo("mainWhatsapp", e.target.value)} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Departments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Detected {departments.length} departments
              </h3>
              <Button variant="outline" size="sm" onClick={addDept}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {departments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No department contacts detected.</p>
            ) : (
              <div className="space-y-2">
                {departments.map((dept, idx) => (
                  <Card key={idx}>
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">{dept.department}</Badge>
                          {dept.contactName && <span className="text-xs text-muted-foreground">{dept.contactName}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                          {dept.emails.map((e, i) => (
                            <span key={i} className="flex items-center gap-1"><Mail className="h-3 w-3" />{e}</span>
                          ))}
                          {dept.phones.map((p, i) => (
                            <span key={i} className="flex items-center gap-1"><Phone className="h-3 w-3" />{p}</span>
                          ))}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeDept(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Locations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-blue-600" />
                Detected {locations.length} locations
              </h3>
              <Button variant="outline" size="sm" onClick={addLocation}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {locations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No branch locations detected.</p>
            ) : (
              <div className="space-y-2">
                {locations.map((loc, idx) => (
                  <Card key={idx}>
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{loc.city || "New Location"}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                          {loc.phones.map((p, i) => (
                            <span key={i} className="flex items-center gap-1"><Phone className="h-3 w-3" />{p}</span>
                          ))}
                          {loc.emails.map((e, i) => (
                            <span key={i} className="flex items-center gap-1"><Mail className="h-3 w-3" />{e}</span>
                          ))}
                          {loc.whatsapp && (
                            <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{loc.whatsapp}</span>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeLocation(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* All detected emails/phones summary */}
          {(extracted.allEmails.length > 0 || extracted.allPhones.length > 0) && (
            <>
              <Separator />
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs font-medium mb-1">All detected contact info</p>
                <div className="flex flex-wrap gap-1">
                  {extracted.allEmails.map((e, i) => (
                    <Badge key={`e-${i}`} variant="outline" className="text-[10px]">{e}</Badge>
                  ))}
                  {extracted.allPhones.map((p, i) => (
                    <Badge key={`p-${i}`} variant="secondary" className="text-[10px]">{p}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Skip
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
            Save & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierInfoReviewModal;

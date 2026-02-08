import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanySettings, CompanySettings } from "@/hooks/useCompanySettings";
import { Loader2, Save, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const CompanyProfileTab = () => {
  const { settings, isLoading, saveSettings, isSaving } = useCompanySettings();
  const [form, setForm] = useState<CompanySettings>(settings);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const update = (key: keyof CompanySettings, value: any) =>
    setForm((p) => ({ ...p, [key]: value }));

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `logo.${ext}`;
      const { error } = await supabase.storage.from("company-logos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("company-logos").getPublicUrl(path);
      update("logo_storage_path", urlData.publicUrl);
      toast({ title: "Logo uploaded ✅" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => saveSettings(form);

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {form.logo_storage_path && (
              <img src={form.logo_storage_path} alt="Logo" className="h-16 w-16 rounded-md object-contain border" />
            )}
            <div>
              <Label>Company Logo</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button variant="outline" size="sm" asChild disabled={uploading}>
                  <label className="cursor-pointer">
                    {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Upload Logo
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                </Button>
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Company Name</Label>
              <Input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} />
            </div>
            <div>
              <Label>VAT Number</Label>
              <Input value={form.vat_number} onChange={(e) => update("vat_number", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Physical Address</Label>
              <Input value={form.physical_address} onChange={(e) => update("physical_address", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Postal Address</Label>
              <Input value={form.postal_address} onChange={(e) => update("postal_address", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
};

export default CompanyProfileTab;

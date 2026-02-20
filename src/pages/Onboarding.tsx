import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Building2, Settings, Users, Rocket, Plus, Trash2, Upload } from "lucide-react";

const SERVICES = [
  "AC Installation",
  "AC Repairs",
  "Maintenance",
  "Ventilation",
  "Refrigeration",
  "Heat Pumps",
  "Geysers",
  "Solar",
];

type CompanyForm = {
  company_name: string;
  phone: string;
  email: string;
  address: string;
};

type BusinessForm = {
  default_rate: number;
  vat_registered: boolean;
  vat_number: string;
};

type Invite = { email: string; role: "admin" | "field_agent" };

const STEP_LABELS = ["Company Details", "Business Setup", "Team Setup", "Welcome"];
const STEP_ICONS = [Building2, Settings, Users, Rocket];

const Onboarding = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [invites, setInvites] = useState<Invite[]>([{ email: "", role: "field_agent" }]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);

  const companyForm = useForm<CompanyForm>({ defaultValues: { company_name: "", phone: "", email: "", address: "" } });
  const businessForm = useForm<BusinessForm>({ defaultValues: { default_rate: 450, vat_registered: false, vat_number: "" } });

  const toggleService = (s: string) =>
    setSelectedServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const nextStep = async () => {
    if (step === 1) {
      const valid = await companyForm.trigger();
      if (!valid) return;
    }
    if (step === 2) {
      const valid = await businessForm.trigger();
      if (!valid) return;
      if (businessForm.getValues("vat_registered") && !businessForm.getValues("vat_number")) {
        businessForm.setError("vat_number", { message: "VAT number required" });
        return;
      }
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  const handleComplete = async () => {
    setSaving(true);
    try {
      const company = companyForm.getValues();
      const business = businessForm.getValues();

      let logo_url: string | null = null;
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("company-logos").upload(path, logoFile);
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("company-logos").getPublicUrl(path);
          logo_url = urlData.publicUrl;
        }
      }

      const { data: inserted, error } = await supabase
        .from("companies")
        .insert({
          name: company.company_name,
          phone: company.phone,
          email: company.email,
          address: { line1: company.address } as any,
          logo_url,
          onboarding_completed: true,
          services: selectedServices,
          default_rate: business.default_rate,
          vat_registered: business.vat_registered,
          vat_number: business.vat_registered ? business.vat_number : null,
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      const companyId = inserted.id;
      setCreatedCompanyId(companyId);
      toast.success("Company created successfully!");
      setStep(4);
    } catch (err: any) {
      toast.error(err.message || "Failed to create company");
    } finally {
      setSaving(false);
    }
  };

  const goToDashboard = () => {
    if (createdCompanyId) {
      navigate(`/client/${createdCompanyId}/dashboard`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 dark:from-[#0b1a2e] dark:to-[#0f2847] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEP_LABELS.map((label, i) => {
              const Icon = STEP_ICONS[i];
              const isComplete = step > i + 1;
              const isCurrent = step === i + 1;
              return (
                <div key={label} className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                      isComplete
                        ? "bg-blue-600 text-white"
                        : isCurrent
                        ? "bg-blue-600 text-white ring-4 ring-blue-200 dark:ring-blue-900"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className={`text-xs mt-1 hidden sm:block ${isCurrent ? "text-blue-600 font-semibold" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${((step - 1) / 3) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 1: Company Details */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-600" /> Company Details</CardTitle>
              <CardDescription>Tell us about your HVAC business</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name *</Label>
                <Input id="company_name" placeholder="e.g. Cool Air Services" {...companyForm.register("company_name", { required: "Required" })} />
                {companyForm.formState.errors.company_name && <p className="text-sm text-destructive">{companyForm.formState.errors.company_name.message}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone *</Label>
                  <Input id="phone" placeholder="0800 123 456" {...companyForm.register("phone", { required: "Required" })} />
                  {companyForm.formState.errors.phone && <p className="text-sm text-destructive">{companyForm.formState.errors.phone.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" placeholder="info@company.co.za" {...companyForm.register("email", { required: "Required" })} />
                  {companyForm.formState.errors.email && <p className="text-sm text-destructive">{companyForm.formState.errors.email.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address *</Label>
                <Input id="address" placeholder="123 Main Rd, Cape Town" {...companyForm.register("address", { required: "Required" })} />
                {companyForm.formState.errors.address && <p className="text-sm text-destructive">{companyForm.formState.errors.address.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Logo (optional)</Label>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="w-16 h-16 rounded-lg object-contain border bg-white" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <Input type="file" accept="image/*" onChange={handleLogoChange} className="max-w-[220px]" />
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <Button onClick={nextStep} className="bg-blue-600 hover:bg-blue-700 text-white">Next →</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Business Setup */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-blue-600" /> Business Setup</CardTitle>
              <CardDescription>Configure your services and rates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Services Offered</Label>
                <div className="grid grid-cols-2 gap-3">
                  {SERVICES.map((s) => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer p-2 rounded-md border hover:bg-accent transition-colors">
                      <Checkbox checked={selectedServices.includes(s)} onCheckedChange={() => toggleService(s)} />
                      <span className="text-sm">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default_rate">Default Hourly Rate (ZAR)</Label>
                <Input
                  id="default_rate"
                  type="number"
                  {...businessForm.register("default_rate", { valueAsNumber: true, min: { value: 0, message: "Must be positive" } })}
                />
                {businessForm.formState.errors.default_rate && <p className="text-sm text-destructive">{businessForm.formState.errors.default_rate.message}</p>}
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={businessForm.watch("vat_registered")}
                    onCheckedChange={(v) => businessForm.setValue("vat_registered", v)}
                  />
                  <Label>VAT Registered</Label>
                </div>
                {businessForm.watch("vat_registered") && (
                  <div className="space-y-2 ml-1">
                    <Label htmlFor="vat_number">VAT Number</Label>
                    <Input id="vat_number" placeholder="e.g. 4123456789" {...businessForm.register("vat_number")} />
                    {businessForm.formState.errors.vat_number && <p className="text-sm text-destructive">{businessForm.formState.errors.vat_number.message}</p>}
                  </div>
                )}
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={prevStep}>← Back</Button>
                <Button onClick={nextStep} className="bg-blue-600 hover:bg-blue-700 text-white">Next →</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Team Setup */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-blue-600" /> Team Setup</CardTitle>
              <CardDescription>Invite team members (optional)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {invites.map((inv, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input
                      placeholder="teammate@company.co.za"
                      value={inv.email}
                      onChange={(e) => {
                        const updated = [...invites];
                        updated[i].email = e.target.value;
                        setInvites(updated);
                      }}
                    />
                  </div>
                  <div className="w-36 space-y-1">
                    <Label className="text-xs">Role</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={inv.role}
                      onChange={(e) => {
                        const updated = [...invites];
                        updated[i].role = e.target.value as "admin" | "field_agent";
                        setInvites(updated);
                      }}
                    >
                      <option value="field_agent">Field Agent</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  {invites.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => setInvites(invites.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setInvites([...invites, { email: "", role: "field_agent" }])}>
                <Plus className="h-4 w-4 mr-1" /> Add Another
              </Button>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={prevStep}>← Back</Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={handleComplete} disabled={saving}>
                    Skip for now
                  </Button>
                  <Button onClick={handleComplete} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {saving ? "Creating..." : "Complete Setup"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Welcome */}
        {step === 4 && (
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center mb-4">
                <Rocket className="h-8 w-8 text-white" />
              </div>
              <CardTitle className="text-2xl">You're All Set! 🎉</CardTitle>
              <CardDescription>Your HVAC company is ready to go</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-left bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                <p><strong>Company:</strong> {companyForm.getValues("company_name")}</p>
                <p><strong>Email:</strong> {companyForm.getValues("email")}</p>
                <p><strong>Phone:</strong> {companyForm.getValues("phone")}</p>
                <p><strong>Services:</strong> {selectedServices.length > 0 ? selectedServices.join(", ") : "None selected"}</p>
                <p><strong>Rate:</strong> R{businessForm.getValues("default_rate")}/hr</p>
                <p><strong>VAT:</strong> {businessForm.getValues("vat_registered") ? `Yes (${businessForm.getValues("vat_number")})` : "No"}</p>
              </div>
              <Button onClick={goToDashboard} className="bg-blue-600 hover:bg-blue-700 text-white w-full" size="lg">
                Go to Dashboard →
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Onboarding;

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCompanySettings, CompanySettings } from "@/hooks/useCompanySettings";
import { Loader2, Building2, CreditCard, Settings, CheckCircle2 } from "lucide-react";

const steps = [
  { title: "Company Details", icon: Building2 },
  { title: "Banking Details", icon: CreditCard },
  { title: "Defaults & Rates", icon: Settings },
  { title: "Complete", icon: CheckCircle2 },
];

interface SetupWizardProps {
  onComplete: () => void;
}

const SetupWizard = ({ onComplete }: SetupWizardProps) => {
  const { saveSettings, isSaving } = useCompanySettings();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CompanySettings>({
    company_name: "0800-BE-COOL AC Super Service",
    vat_number: "",
    physical_address: "",
    postal_address: "",
    logo_storage_path: "",
    default_hourly_rate: 450,
    default_deposit_percentage: 50,
    default_payment_terms_days: 30,
    payfast_merchant_id: "",
    payfast_merchant_key: "",
    banking_details: { bank_name: "FNB", account_number: "", branch_code: "", account_type: "Cheque" },
  });

  const update = (key: keyof CompanySettings, value: any) => setForm((p) => ({ ...p, [key]: value }));
  const updateBanking = (key: string, value: string) =>
    setForm((p) => ({ ...p, banking_details: { ...p.banking_details, [key]: value } }));

  const handleFinish = async () => {
    await saveSettings(form);
    onComplete();
  };

  const progress = ((step + 1) / steps.length) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-4">
          <CardTitle className="text-2xl text-center">Setup Wizard</CardTitle>
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            {steps.map((s, i) => (
              <span key={i} className={i <= step ? "text-primary font-medium" : ""}>
                {s.title}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label>Company Name *</Label>
                <Input value={form.company_name} onChange={(e) => update("company_name", e.target.value)} />
              </div>
              <div>
                <Label>VAT Number</Label>
                <Input value={form.vat_number} onChange={(e) => update("vat_number", e.target.value)} placeholder="e.g. 4123456789" />
              </div>
              <div>
                <Label>Physical Address</Label>
                <Input value={form.physical_address} onChange={(e) => update("physical_address", e.target.value)} />
              </div>
              <div>
                <Label>Postal Address</Label>
                <Input value={form.postal_address} onChange={(e) => update("postal_address", e.target.value)} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Bank Name</Label>
                <Input value={form.banking_details.bank_name || ""} onChange={(e) => updateBanking("bank_name", e.target.value)} />
              </div>
              <div>
                <Label>Account Number</Label>
                <Input value={form.banking_details.account_number || ""} onChange={(e) => updateBanking("account_number", e.target.value)} />
              </div>
              <div>
                <Label>Branch Code</Label>
                <Input value={form.banking_details.branch_code || ""} onChange={(e) => updateBanking("branch_code", e.target.value)} />
              </div>
              <div>
                <Label>Account Type</Label>
                <Input value={form.banking_details.account_type || ""} onChange={(e) => updateBanking("account_type", e.target.value)} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label>Default Hourly Rate (ZAR)</Label>
                <Input type="number" value={form.default_hourly_rate} onChange={(e) => update("default_hourly_rate", parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Default Deposit %</Label>
                <Input type="number" value={form.default_deposit_percentage} onChange={(e) => update("default_deposit_percentage", parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Payment Terms (days)</Label>
                <Input type="number" value={form.default_payment_terms_days} onChange={(e) => update("default_payment_terms_days", parseInt(e.target.value) || 30)} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center space-y-4 py-6">
              <CheckCircle2 className="h-16 w-16 text-primary mx-auto" />
              <h3 className="text-xl font-semibold">All Set!</h3>
              <p className="text-muted-foreground">Your company settings are configured. You can update them anytime from the Settings page.</p>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
              Back
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !form.company_name}>
                Next
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Finish Setup
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SetupWizard;

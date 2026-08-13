import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanySettings, CompanySettings } from "@/hooks/useCompanySettings";
import { Loader2, Save } from "lucide-react";

const BillingTab = () => {
  const { settings, isLoading, saveSettings, isSaving } = useCompanySettings();
  const [form, setForm] = useState<CompanySettings>(settings);

  useEffect(() => { setForm(settings); }, [settings]);

  const update = (key: keyof CompanySettings, value: any) => setForm((p) => ({ ...p, [key]: value }));
  const updateBanking = (key: string, value: string) =>
    setForm((p) => ({ ...p, banking_details: { ...p.banking_details, [key]: value } }));

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Default Rates</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Hourly Rate (ZAR)</Label>
            <Input type="number" value={form.default_hourly_rate} onChange={(e) => update("default_hourly_rate", parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Deposit %</Label>
            <Input type="number" value={form.default_deposit_percentage} onChange={(e) => update("default_deposit_percentage", parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Payment Terms (days)</Label>
            <Input type="number" value={form.default_payment_terms_days} onChange={(e) => update("default_payment_terms_days", parseInt(e.target.value) || 30)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Banking Details (shown on invoices)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Account Name</Label>
            <Input value={form.banking_details.account_name || ""} onChange={(e) => updateBanking("account_name", e.target.value)} placeholder={form.company_name || "e.g. 0800-BE-COOL AC Super Service"} />
          </div>
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
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => saveSettings(form)} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Billing Settings
        </Button>
      </div>
    </div>
  );
};

export default BillingTab;

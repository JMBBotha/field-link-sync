import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { fetchCompanyProfiles, type CompanyProfile } from "@/lib/companyProfiles";

const FIELDS: { key: keyof CompanyProfile; label: string; wide?: boolean }[] = [
  { key: "legal_name", label: "Company name" },
  { key: "vat_number", label: "VAT number (leave empty if not registered)" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "website", label: "Website" },
  { key: "logo_url", label: "Logo image URL (optional; empty = no logo, Massair uses its own artwork)" },
  { key: "bank_name", label: "Bank" },
  { key: "account_name", label: "Account name" },
  { key: "account_number", label: "Account number" },
  { key: "branch_code", label: "Branch code" },
  { key: "account_type", label: "Account type" },
  { key: "invoice_prefix", label: "Invoice number prefix" },
];

/** Each issuing company (Massair CT, Massair Ind CC): own name, VAT, banking, terms and invoice numbers. Admin only (RLS). */
export default function InvoiceCompaniesCard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CompanyProfile[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const { isMain } = useIsMainCompany();

  useEffect(() => { fetchCompanyProfiles().then(setRows); }, []);

  const update = (id: string, key: keyof CompanyProfile, value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  const save = async (r: CompanyProfile) => {
    setSaving(r.id);
    const patch = {
      legal_name: r.legal_name.trim(), vat_number: r.vat_number?.trim() || null, phone: r.phone || null, email: r.email || null,
      bank_name: r.bank_name || null, account_name: r.account_name || null, account_number: r.account_number?.trim() || null,
      branch_code: r.branch_code?.trim() || null, account_type: r.account_type || null, invoice_prefix: r.invoice_prefix || "INV-",
      terms_text: r.terms_text?.trim() || null,
      whatsapp: r.whatsapp?.trim() || null, website: r.website?.trim() || null, logo_url: r.logo_url?.trim() || null,
      document_style: r.document_style === "bold" ? "bold" : "light",
      address_lines: (Array.isArray(r.address_lines) ? r.address_lines : String(r.address_lines || "").split("\n")).map((l) => l.trim()).filter(Boolean),
      updated_at: new Date().toISOString(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("company_profiles").update(patch).eq("id", r.id);
    setSaving(null);
    toast(error ? { title: "Couldn't save", description: error.message, variant: "destructive" } : { title: `${r.legal_name} saved`, description: "New and draft invoices use it. Sent invoices keep what they printed." });
  };

  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Invoice companies</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Each company prints its own name, VAT number, banking and terms on its invoices, with its own invoice numbers.
          Terms placeholders: {"{company} {vat} {bank} {account_name} {account} {branch} {account_type}"}. Leave terms empty to use the standard terms with this company's name and banking.
        </p>
        {rows.map((r) => (
          <div key={r.id} className="space-y-3 rounded-lg border p-4" data-testid="invoice-company">
            <p className="font-semibold">{r.legal_name}{r.is_default ? " (default)" : ""}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key as string}>
                  <Label>{f.label}</Label>
                  <Input value={(r[f.key] as string) || ""} onChange={(e) => update(r.id, f.key, e.target.value)} />
                </div>
              ))}
              <div>
                <Label htmlFor={`docstyle-${r.id}`}>Document design (quotes, invoices, POs)</Label>
                <select id={`docstyle-${r.id}`} data-testid="document-style" value={r.document_style === "bold" ? "bold" : "light"}
                  onChange={(e) => update(r.id, "document_style", e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="light">Light (default)</option>
                  <option value="bold">Bold</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Address (one line each)</Label>
                <Textarea value={Array.isArray(r.address_lines) ? r.address_lines.join("\n") : (r.address_lines as unknown as string) || ""}
                  onChange={(e) => update(r.id, "address_lines", e.target.value)} className="min-h-[70px]" />
              </div>
              <div className="md:col-span-2">
                <Label>Terms and conditions {isMain ? "(main company: used by every company, with each company's own name)" : "(from the main company, with your company name)"}</Label>
                <Textarea data-testid="terms-text" readOnly={!isMain} value={r.terms_text || ""} onChange={(e) => isMain && update(r.id, "terms_text", e.target.value)} className="min-h-[100px]" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => save(r)} disabled={saving === r.id}>
                {saving === r.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

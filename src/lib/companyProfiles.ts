/**
 * Issuing company profiles (Massair CT, Massair Ind CC, ...) inside one tenant.
 * Name, VAT number, address, banking and terms live in the company_profiles table (editable by admins),
 * never in code. An invoice stores company_profile_id; once sent it also stores profile_snapshot
 * so an old PDF never changes when a profile is edited later.
 */
import { supabase } from "@/integrations/supabase/client";
import { COMPANY, COMPANY_BLOCK_LINES, COMPANY_CONTACT_LINE } from "@/lib/companyIdentity";
import type { TermsCompanyInfo } from "@/lib/defaultTerms";

export interface CompanyProfile {
  id: string;
  company_id: string;
  legal_name: string;
  trading_name: string | null;
  vat_number: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  whatsapp: string | null;
  address_lines: string[] | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  branch_code: string | null;
  account_type: string | null;
  terms_text: string | null;
  invoice_prefix: string;
  use_shared_sequence: boolean;
  next_invoice_no?: number;
  is_default: boolean;
  archived_at: string | null;
}

const s = (v: unknown) => String(v ?? "").replace(/[[\]{}()]/g, "").replace(/\s+/g, " ").trim();

/** Right-hand company block lines for a document. No profile = today's fixed block (unchanged). */
export function profileBlockLines(p?: Partial<CompanyProfile> | null): string[] {
  if (!p || !p.legal_name) return COMPANY_BLOCK_LINES;
  return [
    p.legal_name,
    ...(p.phone ? [p.phone] : []),
    ...(p.vat_number && s(p.vat_number) ? [`VAT No ${s(p.vat_number)}`] : []),
    ...((p.address_lines || []).filter(Boolean) as string[]),
  ];
}

export function profileContactLine(p?: Partial<CompanyProfile> | null): string {
  if (!p || !p.legal_name) return COMPANY_CONTACT_LINE;
  return [p.whatsapp && `WhatsApp/Cell ${p.whatsapp}`, p.email, p.website].filter(Boolean).join(" · ");
}

export interface ProfileBanking {
  account_name: string;
  bank_name: string;
  account_number: string;
  branch_code: string;
  account_type: string;
}

export function profileBanking(p?: Partial<CompanyProfile> | null): ProfileBanking | null {
  if (!p || !p.legal_name) return null;
  return {
    account_name: s(p.account_name) || p.legal_name,
    bank_name: s(p.bank_name),
    account_number: s(p.account_number),
    branch_code: s(p.branch_code),
    account_type: s(p.account_type),
  };
}

/** Fill {company} {vat} {bank} {account_name} {account} {branch} {account_type} in a company's own terms text. */
export function fillTermsPlaceholders(text: string, p: Partial<CompanyProfile>): string {
  const b = profileBanking(p);
  const map: Record<string, string> = {
    company: p.legal_name || "",
    trading_name: p.trading_name || p.legal_name || "",
    vat: s(p.vat_number),
    bank: b?.bank_name || "",
    account_name: b?.account_name || "",
    account: b?.account_number || "",
    branch: b?.branch_code || "",
    account_type: b?.account_type || "",
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

/** Terms-page info for the PDF, built only from this profile (no other company's data can leak in). */
export function profileTermsInfo(p?: Partial<CompanyProfile> | null): TermsCompanyInfo | null {
  if (!p || !p.legal_name) return null;
  const b = profileBanking(p)!;
  return {
    companyName: p.legal_name,
    bankName: b.bank_name || undefined,
    accountName: b.account_name,
    accountNumber: b.account_number || undefined,
    branchCode: b.branch_code || undefined,
    accountType: b.account_type || undefined,
    customText: p.terms_text ? fillTermsPlaceholders(p.terms_text, p) : undefined,
    footerLine: [p.legal_name, p.phone, p.vat_number && s(p.vat_number) ? `VAT No ${s(p.vat_number)}` : null, (p.address_lines || []).join(", ")]
      .filter(Boolean).join(" · "),
    contactLine: profileContactLine(p),
  };
}

/** The profile a document should print: the frozen snapshot once sent, else the live profile. */
export function documentProfile(invoice: { profile_snapshot?: unknown; company_profile_id?: string | null } | null | undefined,
  profiles: CompanyProfile[]): CompanyProfile | null {
  if (!invoice) return null;
  const snap = invoice.profile_snapshot as CompanyProfile | null | undefined;
  if (snap && snap.legal_name) return snap;
  return profiles.find((p) => p.id === invoice.company_profile_id) || null;
}

export async function fetchCompanyProfiles(): Promise<CompanyProfile[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from as any)("company_profiles")
    .select("*")
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("legal_name");
  if (error) return [];
  return (data || []) as CompanyProfile[];
}

export async function fetchCompanyProfile(id: string | null | undefined): Promise<CompanyProfile | null> {
  if (!id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from as any)("company_profiles").select("*").eq("id", id).maybeSingle();
  return (data as CompanyProfile) || null;
}

/* ───────── Money maths (same rules as the DB trigger) ───────── */

export type DiscountType = "percent" | "fixed";
export type DepositType = "percent" | "fixed";
export const VAT_PERCENT = COMPANY.vatRatePercent; // 15, every line

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function invoiceTotals(lineAmounts: number[], discount?: { type: DiscountType; value: number } | null) {
  const subtotal = r2(lineAmounts.reduce((a, b) => a + (Number(b) || 0), 0));
  const discountAmount = !discount || !discount.value ? 0
    : r2(discount.type === "percent" ? subtotal * Math.min(100, Math.max(0, discount.value)) / 100 : Math.max(0, discount.value));
  const taxable = r2(subtotal - discountAmount);
  const vat = r2(taxable * VAT_PERCENT / 100);
  return { subtotal, discountAmount, taxable, vat, total: r2(taxable + vat) };
}

/** Deposit on the VAT-INCLUSIVE total (FreshBooks uses the subtotal; Johan wants incl. VAT). */
export function depositAmount(totalInclVat: number, type: DepositType | null | undefined, value: number | null | undefined): number {
  if (!type || !value || value <= 0) return 0;
  if (type === "percent") return r2((Number(totalInclVat) || 0) * Math.min(100, value) / 100);
  return r2(Math.min(value, Number(totalInclVat) || 0));
}

export function depositDue(deposit: number, paid: number): number {
  return r2(Math.max(0, (Number(deposit) || 0) - (Number(paid) || 0)));
}

import { supabase } from "@/integrations/supabase/client";

/**
 * Money-free company profile (P9). Techs (field-agent only) can no longer read
 * company_settings (rates, banking, PayFast keys); this server RPC returns only
 * what they may see: name, VAT no., addresses, logo, deposit % and terms.
 */
export interface CompanyProfileSafe {
  company_id: string;
  company_name: string | null;
  vat_number: string | null;
  physical_address: string | null;
  postal_address: string | null;
  office_address: string | null;
  logo_storage_path: string | null;
  logo_url: string | null;
  default_deposit_percentage: number | null;
  default_payment_terms_days: number | null;
}

export const SAFE_PROFILE_KEYS: (keyof CompanyProfileSafe)[] = [
  "company_id", "company_name", "vat_number", "physical_address", "postal_address",
  "office_address", "logo_storage_path", "logo_url", "default_deposit_percentage", "default_payment_terms_days",
];

export async function fetchCompanyProfileSafe(): Promise<CompanyProfileSafe | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("company_profile_safe");
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row as CompanyProfileSafe) ?? null;
  } catch {
    return null;
  }
}

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * company_settings fields a quote document may read.
 * The row is always the quote's own company (company_id), never the newest
 * settings row visible to a multi-company admin.
 */
export interface QuoteCompanySettings {
  company_name: string | null;
  physical_address: string | null;
  vat_number: string | null;
  banking_details: Record<string, string | undefined> | null;
  default_deposit_percentage: number | null;
  default_payment_terms_days: number | null;
}

function bankingRecord(value: Json | null): Record<string, string | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string | undefined> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null) out[key] = undefined;
    else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
  }
  return out;
}

/**
 * The quote company's own settings row.
 * Same order as get_public_quote / create_deposit_invoice_for_quote:
 * is_primary, then updated_at, then id — and only this company_id.
 * A newer row from another company the caller can see must not win.
 * No company id → no row (do not fall through to whichever settings row is newest).
 */
export async function fetchQuoteCompanySettings(companyId: string | null | undefined): Promise<QuoteCompanySettings | null> {
  if (!companyId) return null;
  const { data, error } = await supabase
    .from("company_settings")
    .select("company_name, physical_address, vat_number, banking_details, default_deposit_percentage, default_payment_terms_days")
    .eq("company_id", companyId)
    .order("is_primary", { ascending: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    company_name: data.company_name,
    physical_address: data.physical_address,
    vat_number: data.vat_number,
    banking_details: bankingRecord(data.banking_details),
    default_deposit_percentage: data.default_deposit_percentage,
    default_payment_terms_days: data.default_payment_terms_days,
  };
}

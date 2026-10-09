import { supabase } from "@/integrations/supabase/client";

/**
 * Company pricing (P10): hourly rate, units/materials markup, materials waste.
 * These companies columns are no longer directly selectable; the server RPC
 * returns them to company members who are NOT field techs (admins, office,
 * sales reps) and nothing to techs.
 */
export interface CompanyPricing {
  company_id: string;
  default_rate: number | null;
  units_markup_percent: number | null;
  materials_markup_percent: number | null;
  materials_waste_percent: number | null;
}

export async function fetchCompanyPricing(companyId: string | null | undefined): Promise<CompanyPricing | null> {
  if (!companyId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("get_company_pricing_settings", { p_company_id: companyId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row as CompanyPricing) ?? null;
  } catch {
    return null;
  }
}

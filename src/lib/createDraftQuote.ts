/**
 * createDraftQuoteForCustomer — inserts ONE real `quotes` row (status=draft)
 * linked to a customer, company-scoped. Same payload shape the unified
 * builder writes; used by the voice entry point so voice never owns a
 * parallel draft object. Returns the new quote id.
 */
import { supabase } from "@/integrations/supabase/client";
import { getUserCompanyId } from "@/lib/tenantUtils";

export async function createDraftQuoteForCustomer(
  userId: string,
  customerId: string,
  customerName?: string | null,
): Promise<string> {
  if (!customerId) throw new Error("Cannot create quote: no client linked.");
  const companyId = await getUserCompanyId(userId);
  if (!companyId) throw new Error("Your account is not linked to a company. Contact an admin.");

  const payload: Record<string, unknown> = {
    sales_engineer_id: userId,
    company_id: companyId,
    status: "draft",
    subtotal: 0,
    vat_rate: 0.15,
    vat_amount: 0,
    total: 0,
    customer_id: customerId,
  };
  if (customerName && customerName.trim()) payload.customer_name = customerName.trim();

  const { data, error } = await (supabase.from("quotes") as any).insert(payload).select("id").single();
  if (error) throw error;
  return data.id as string;
}

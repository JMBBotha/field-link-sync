import { supabase } from "@/integrations/supabase/client";

export interface DepositInvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string | null;
  grand_total: number | null;
  paid_date: string | null;
  notes: string | null;
}

/** The single invoice hung on this quote (deposit invoice), if any. */
export async function fetchQuoteInvoice(quoteId: string): Promise<DepositInvoiceRow | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, status, grand_total, paid_date, notes")
    .eq("quote_id", quoteId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DepositInvoiceRow) ?? null;
}

/**
 * Create the deposit invoice for an accepted quote.
 * Idempotent: the RPC returns the existing invoice id when one already exists.
 * Amount = quote total x company_settings.default_deposit_percentage (fallback 50%).
 */
export async function ensureDepositInvoiceForQuote(quoteId: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_deposit_invoice_for_quote", {
    p_quote_id: quoteId,
  } as any);
  if (error) throw error;
  if (!data) throw new Error("Could not create the deposit invoice for this quote");
  return data as unknown as string;
}

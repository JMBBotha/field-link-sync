import { supabase } from "@/integrations/supabase/client";

export interface DepositInvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string | null;
  grand_total: number | null;
  paid_date: string | null;
  notes: string | null;
  amount_paid?: number | null;
  remaining?: number | null;
}

/** The single invoice hung on this quote (deposit invoice), if any. Signed-in tenant users only. */
export async function fetchQuoteInvoice(quoteId: string): Promise<DepositInvoiceRow | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, status, grand_total, paid_date, notes")
    .eq("quote_id", quoteId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const invoice = data as DepositInvoiceRow;
  try {
    const { data: pays, error: payErr } = await supabase
      .from("payments")
      .select("amount, status")
      .eq("invoice_id", invoice.id)
      .eq("status", "paid");
    if (!payErr && pays) {
      const paid = (pays as any[]).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      invoice.amount_paid = paid;
      invoice.remaining = Math.max(0, (Number(invoice.grand_total) || 0) - paid);
    }
  } catch {
    // payments not readable — chip falls back to status only
  }
  return invoice;
}

/**
 * Batch variant: attach amount_paid / remaining (from paid payments) to any
 * set of invoice-like rows so the shared deposit chip can always show R…
 * Mutates and returns the same array.
 */
export async function attachPaymentTotals<
  T extends { id?: string | null; grand_total?: number | null; amount_paid?: number | null; remaining?: number | null },
>(invoices: T[]): Promise<T[]> {
  const ids = invoices.map((i) => i.id).filter(Boolean) as string[];
  if (ids.length === 0) return invoices;
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("invoice_id, amount, status")
      .in("invoice_id", ids)
      .eq("status", "paid");
    if (error || !data) return invoices;
    const paidByInvoice = new Map<string, number>();
    for (const p of data as any[]) {
      paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + (Number(p.amount) || 0));
    }
    for (const inv of invoices) {
      if (!inv.id) continue;
      const paid = paidByInvoice.get(inv.id) || 0;
      inv.amount_paid = paid;
      inv.remaining = Math.max(0, (Number(inv.grand_total) || 0) - paid);
    }
  } catch {
    // payments not readable — chip falls back to status/grand_total
  }
  return invoices;
}


/**
 * Public token path for anonymous clients on /quote/:token.
 * Token-gated SECURITY DEFINER RPC — returns only chip/pay fields for the
 * single deposit invoice linked to that quote, or null.
 */
export async function fetchQuoteInvoiceByToken(token: string): Promise<DepositInvoiceRow | null> {
  const { data, error } = await supabase.rpc("get_deposit_invoice_by_quote_token", {
    p_token: token,
  } as any);
  if (error) throw error;
  return (data as unknown as DepositInvoiceRow) ?? null;
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

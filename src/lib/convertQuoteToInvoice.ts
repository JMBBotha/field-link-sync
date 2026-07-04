import { supabase } from "@/integrations/supabase/client";

/**
 * Convert an accepted quote into a draft invoice using the legacy invoices stack.
 *
 * - Copies customer_id, location_id, lead_id, company_id from the quote.
 * - Flattens quote.visual_sections zones+items into invoice.line_items
 *   in the shape { description, quantity, rate, amount }.
 * - Uses the quote totals (subtotal, vat_rate, vat_amount, total) as-is.
 * - Links invoice.quote_id back to the source quote.
 * - Stamps job.invoice_id if a job already exists for this quote's lead.
 *
 * Returns the new invoice id.
 */
export async function convertQuoteToInvoice(quoteId: string, agentUserId: string): Promise<string> {
  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select(
      "id, company_id, customer_id, location_id, lead_id, customer_name, subtotal, vat_rate, vat_amount, total, notes, visual_sections, status",
    )
    .eq("id", quoteId)
    .single();
  if (qErr || !quote) throw qErr || new Error("Quote not found");

  // Prefer accepted quotes, but allow draft/sent (dispatcher discretion).
  // Do NOT convert quotes that are already declined.
  if (quote.status === "declined") {
    throw new Error("Declined quotes cannot be converted to an invoice");
  }

  // Prevent duplicate invoices from the same quote.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (existing?.id) return existing.id;

  // Flatten zones → line items.
  const zones: any[] = Array.isArray(quote.visual_sections) ? (quote.visual_sections as any[]) : [];
  const lineItems: Array<{ description: string; quantity: number; rate: number; amount: number }> = [];
  zones.forEach((z) => {
    const items: any[] = Array.isArray(z?.items) ? z.items : [];
    items.forEach((i) => {
      const qty = Number(i.quantity ?? i.length ?? 1) || 1;
      const rate = Number(i.unitPrice ?? i.pricePerMetre ?? 0) || 0;
      const amount = Number((qty * rate).toFixed(2));
      const zonePrefix = z?.name ? `[${z.name}] ` : "";
      lineItems.push({
        description: `${zonePrefix}${i.productName || i.productCode || "Item"}`,
        quantity: qty,
        rate,
        amount,
      });
    });
  });

  // Look up customer contact bits for legacy denormalised columns.
  let customer_phone: string | null = null;
  let customer_address: string | null = null;
  let customer_email: string | null = null;
  if (quote.customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("phone, address, email")
      .eq("id", quote.customer_id)
      .maybeSingle();
    customer_phone = cust?.phone ?? null;
    customer_address = cust?.address ?? null;
    customer_email = cust?.email ?? null;
  }

  // Generate invoice number via existing RPC.
  const { data: invoiceNumber, error: nErr } = await supabase.rpc("generate_invoice_number");
  if (nErr) throw nErr;

  const { data: inserted, error: iErr } = await supabase
    .from("invoices")
    .insert([
      {
        invoice_number: invoiceNumber,
        quote_id: quote.id,
        lead_id: quote.lead_id,
        customer_id: quote.customer_id,
        location_id: (quote as any).location_id ?? null,
        company_id: quote.company_id,
        agent_id: agentUserId,
        customer_name: quote.customer_name || "Customer",
        customer_phone,
        customer_address,
        customer_email,
        line_items: lineItems,
        subtotal: quote.subtotal,
        tax_rate: Number(quote.vat_rate) * 100, // legacy invoices store % (e.g. 15), quotes store 0.15
        tax_amount: quote.vat_amount,
        grand_total: quote.total,
        status: "draft",
        notes: quote.notes,
      } as any,
    ])
    .select("id")
    .single();
  if (iErr || !inserted) throw iErr || new Error("Failed to create invoice");

  // If a job already exists for this lead, stamp its invoice_id.
  if (quote.lead_id) {
    await supabase
      .from("jobs")
      .update({ invoice_id: inserted.id } as any)
      .eq("lead_id", quote.lead_id);
  }

  return inserted.id;
}

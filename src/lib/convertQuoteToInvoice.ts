import { supabase } from "@/integrations/supabase/client";

export interface FlatQuoteLineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

/**
 * Flatten a quote's areas + items into simple line items.
 * Prefers the unified quote_items table (single source of truth) and falls back
 * to the legacy visual_sections JSON blob for older quotes.
 * Shared by invoice conversion and the read-only estimate document.
 */
export async function buildQuoteLineItems(
  quoteId: string,
  visualSections?: unknown,
): Promise<FlatQuoteLineItem[]> {
  const lineItems: FlatQuoteLineItem[] = [];

  const [{ data: items }, { data: areas }] = await Promise.all([
    supabase
      .from("quote_items")
      .select("item_name, item_number, description, quantity, unit_price, total_price, area_id, parent_item_id, sort_order")
      .eq("quote_id", quoteId)
      .is("parent_item_id", null)
      .order("sort_order"),
    supabase.from("quote_areas").select("id, name").eq("quote_id", quoteId),
  ]);

  const areaName = new Map<string, string>((areas || []).map((a: any) => [a.id, a.name]));

  if (items && items.length > 0) {
    items.forEach((i: any) => {
      const qty = Number(i.quantity) || 1;
      const rate = Number(i.unit_price) || 0;
      const amount = i.total_price != null ? Number(i.total_price) : Number((qty * rate).toFixed(2));
      const prefix = i.area_id && areaName.get(i.area_id) ? `[${areaName.get(i.area_id)}] ` : "";
      // Compose a rich, self-contained line: name, then model no. and full
      // description on their own lines so nothing captured at quote-build
      // time (model number, spec description) is ever lost on the document.
      const name = i.item_name || i.description || "Item";
      const detailParts: string[] = [];
      if (i.item_number) detailParts.push(`Model: ${i.item_number}`);
      if (i.description && i.description !== name) detailParts.push(i.description);
      const description = detailParts.length > 0
        ? `${prefix}${name}\n${detailParts.join(" — ")}`
        : `${prefix}${name}`;
      lineItems.push({
        description,
        quantity: qty,
        rate,
        amount,
      });
    });
  } else {
    const zones: any[] = Array.isArray(visualSections) ? (visualSections as any[]) : [];
    zones.forEach((z) => {
      const zItems: any[] = Array.isArray(z?.items) ? z.items : [];
      zItems.forEach((i) => {
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
  }

  return lineItems;
}


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

  const lineItems = await buildQuoteLineItems(quoteId, quote.visual_sections);


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

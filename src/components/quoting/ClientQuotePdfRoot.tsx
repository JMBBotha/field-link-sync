import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import EstimateDocument, { type EstimateDocLineItem } from "./EstimateDocument";
import { buildClientRollup, clientDiscount, lineQtyText, rollupLineFromRow, type ClientRollupArea } from "@/lib/clientQuoteRollup";

/**
 * Off-screen, client-facing render of ONE quote, used only for PDF capture
 * (estimate PDF button, Mandy ?mandy=pdf, Send dialog download/email).
 * Mirrors the /quote page (ClientProposalView) prop-for-prop so the PDF and
 * the live link print identically. Loads fresh from the DB on every mount.
 * Capture target: clientPdfSelector(quoteId) — unique per quote, and only
 * matches once data has loaded, so the staff editor can never be captured.
 */
export const clientPdfSelector = (quoteId: string) =>
  `[data-client-pdf-root="${quoteId}"][data-ready="true"] [data-pdf-capture-root="estimate"]`;

/** Waits for the wrapper to finish loading (and its images to decode); returns the capture selector. */
export async function waitForClientPdfRoot(quoteId: string, timeoutMs = 10000): Promise<string> {
  const started = Date.now();
  const selector = clientPdfSelector(quoteId);
  for (;;) {
    const wrapper = document.querySelector(`[data-client-pdf-root="${quoteId}"]`);
    const err = wrapper?.getAttribute("data-error");
    if (err) throw new Error(err);
    const el = document.querySelector(selector);
    if (el) {
      const imgs = Array.from(el.querySelectorAll("img"));
      imgs.forEach((img) => img.setAttribute("loading", "eager"));
      await Promise.race([
        Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      return selector;
    }
    if (Date.now() - started > timeoutMs) throw new Error("Client PDF view did not load in time — please try again.");
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Collapses stray whitespace in stored first/last names (same as /quote). */
const tidyName = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

type Loaded = {
  quote: any;
  customer: { name: string | null; company_name: string | null; address: string | null; email: string | null; phone: string | null } | null;
  company: any;
  items: EstimateDocLineItem[];
  areas: ClientRollupArea[];
};

const ClientQuotePdfRoot = ({ quoteId }: { quoteId: string }) => {
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qRes, iRes, aRes, cRes] = await Promise.all([
          (supabase.from("quotes") as any)
            .select(
              "id, quote_number, subtotal, vat_rate, vat_amount, total, notes, valid_until, created_at, customer_name, terms_text, discount_type, discount_value, payment_plan, customers(name, first_name, last_name, company_name, primary_address_line1, email, phone)",
            )
            .eq("id", quoteId)
            .maybeSingle(),
          (supabase.from("quote_items") as any)
            .select(
              "id, item_name, description, quantity, unit_price, total_price, sort_order, product_id, area_id, item_type, item_number, is_bundle, parent_item_id, supplier_products(image_url, category, brand, btu_rating, capacity_btu, kw, ai_sales_description, product_code)",
            )
            .eq("quote_id", quoteId)
            .is("parent_item_id", null)
            .order("sort_order"),
          (supabase.from("quote_areas") as any)
            .select("id, name, sort_order")
            .eq("quote_id", quoteId)
            .order("sort_order", { nullsFirst: false })
            .order("created_at"),
          (supabase.from("company_settings") as any)
            .select("company_name, physical_address, vat_number, banking_details, default_deposit_percentage, default_payment_terms_days")
            .limit(1)
            .maybeSingle(),
        ]);
        if (qRes.error) throw qRes.error;
        if (iRes.error) throw iRes.error;
        if (aRes.error) throw aRes.error;
        if (!qRes.data) throw new Error("Quote not found.");
        const areaRows = (aRes.data || []) as { id: string; name: string; sort_order: number | null }[];
        const names = new Map(areaRows.map((a) => [a.id, a.name]));
        const lines = ((iRes.data || []) as any[]).map((r) => rollupLineFromRow(r, names));
        const c = qRes.data.customers;
        const customer = c
          ? {
              name: tidyName(`${c.first_name || ""} ${c.last_name || ""}`) || c.name || null,
              company_name: c.company_name ?? null,
              address: c.primary_address_line1 ?? null,
              email: c.email ?? null,
              phone: c.phone ?? null,
            }
          : null;
        // Same line shape as the /quote page (only used if a quote has no roll-up blocks).
        const items: EstimateDocLineItem[] = lines.map((it) => {
          const name = it.item_name || it.description || "Item";
          const blurb = it.item_name ? it.description || null : null;
          const quantity = Number(it.quantity) || 0;
          const unit_price = Number(it.unit_price) || 0;
          return {
            description: blurb ? `${name}\n${blurb}` : name,
            quantity,
            unit_price,
            amount: Number(it.total_price) || quantity * unit_price,
            qtyText: lineQtyText(it),
            imageUrl: it.image_url || null,
          };
        });
        if (!cancelled) setDoc({ quote: qRes.data, customer, company: cRes.data || null, items, areas: buildClientRollup(lines, areaRows) });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load the quote for the PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const q = doc?.quote;
  const subtotal = Number(q?.subtotal) || 0;
  const discount = clientDiscount(subtotal, q?.discount_type, q?.discount_value);
  const customerName = tidyName(doc?.customer?.name || q?.customer_name || "") || "Valued Customer";

  return (
    <div
      data-client-pdf-root={quoteId}
      data-ready={doc ? "true" : "false"}
      data-error={error || undefined}
      style={{ position: "fixed", top: 0, left: "-10000px", width: "820px", pointerEvents: "none" }}
      aria-hidden="true"
    >
      {doc && q && (
        <EstimateDocument
          estimateNumber={q.quote_number}
          issueDate={q.created_at}
          validUntil={q.valid_until}
          customerName={customerName}
          customerCompany={doc.customer?.company_name}
          customerAddress={doc.customer?.address}
          customerEmail={doc.customer?.email}
          customerPhone={doc.customer?.phone}
          items={doc.items}
          presentationMode="clientRollup"
          clientAreas={doc.areas}
          subtotal={subtotal}
          taxRate={Number(q.vat_rate) || 0.15}
          taxAmount={Number(q.vat_amount) || 0}
          grandTotal={Number(q.total) || 0}
          notes={q.notes}
          termsText={q.terms_text}
          discountAmount={discount.amount}
          discountLabel={discount.label}
          companyOverride={doc.company}
          paymentPlan={q.payment_plan ?? null}
        />
      )}
    </div>
  );
};

export default ClientQuotePdfRoot;

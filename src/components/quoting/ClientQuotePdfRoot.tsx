import { QuoteSitePhotosBlock, loadQuoteSitePhotos, type QuoteSitePhoto } from "./QuoteSitePhotos";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import EstimateDocument, { type EstimateDocLineItem } from "./EstimateDocument";
import { QuoteUnitCardsView, ensureUnitContent } from "./QuoteUnitCards";
import type { BrochureCompany } from "@/lib/unitBrochure";
import { buildUnitCards, missingModelKeys, unitLineModelKey, type ProductMedia, type UnitCard } from "@/lib/unitCards";
import { buildClientRollup, clientDiscount, lineQtyText, rollupLineFromRow, type ClientRollupArea } from "@/lib/clientQuoteRollup";

/**
 * Off-screen, client-facing render of ONE quote, used only for PDF capture
 * (estimate PDF button, Mandy ?mandy=pdf, Send dialog download/email).
 * Mirrors the /quote page (ClientProposalView) prop-for-prop so the PDF and
 * the live link print identically. Loads fresh from the DB on every mount.
 * Capture target: clientPdfSelector(quoteId) — unique per quote, and only
 * matches once data has loaded, so the staff editor can never be captured.
 */
/** Appended A4 brochure pages for this quote (only rendered for approved models). */
export const clientBrochureSelector = (quoteId: string) =>
  `[data-client-pdf-root="${quoteId}"][data-ready="true"] [data-brochure-page="${quoteId}"]`;

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
  customer: { name: string | null; company_name: string | null; address: string | null; email: string | null; phone: string | null; vat_number?: string | null } | null;
  company: any;
  items: EstimateDocLineItem[];
  areas: ClientRollupArea[];
  unitCards: UnitCard[];
  brochureCompany: BrochureCompany | null;
  sitePhotos: QuoteSitePhoto[];
};

const ClientQuotePdfRoot = ({ quoteId }: { quoteId: string }) => {
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qRes, iRes, aRes, cRes, dRes] = await Promise.all([
          (supabase.from("quotes") as any)
            .select(
              "id, company_id, quote_number, subtotal, vat_rate, vat_amount, total, notes, valid_until, created_at, customer_name, terms_text, discount_type, discount_value, payment_plan, remote_quote, remote_quote_source, relocation_clause, customers(name, first_name, last_name, company_name, primary_address_line1, email, phone, vat_number)",
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
            // Same row as invoices/statements: the newest settings row.
            .order("updated_at", { ascending: false, nullsFirst: false })
            .order("id")
            .limit(1)
            .maybeSingle(),
          // Deposit % must match the deposit invoice: latest settings row (same order as create_deposit_invoice_for_quote).
          (supabase.from("company_settings") as any)
            .select("default_deposit_percentage")
            .order("updated_at", { ascending: false, nullsFirst: false })
            .order("id")
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
              vat_number: c.vat_number ?? null,
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
        // Unit cards (after totals, before terms): per-quote toggle, approved content only; never blocks the PDF.
        let unitCards: UnitCard[] = [];
        try {
          const { data: flag } = await (supabase.from("quotes") as any).select("show_unit_cards").eq("id", quoteId).maybeSingle();
          if (flag?.show_unit_cards !== false) {
            const keys = [...new Set(lines.map((l: any) => unitLineModelKey(l)).filter(Boolean))] as string[];
            if (keys.length) {
              const { data: media } = await (supabase.from("product_media" as never) as any).select("*").in("model_key", keys);
              const map = new Map<string, ProductMedia>(((media || []) as ProductMedia[]).map((m) => [m.model_key, m]));
              unitCards = buildUnitCards(lines as any, map);
              const missing = missingModelKeys(lines as any, map.keys());
              if (missing.length) void ensureUnitContent(missing);
            }
          }
        } catch { /* optional section */ }
        // Sender-company branding for appended brochure pages (same public lookup as /u), only when needed.
        let brochureCompany: BrochureCompany | null = null;
        if (unitCards.some((c) => c.media?.status === "approved") && (qRes.data as any)?.company_id) {
          try {
            const { data: b } = await (supabase.rpc as any)("public_unit_brochure", { p_model: unitCards[0].modelKey, p_company: (qRes.data as any).company_id });
            brochureCompany = (b as any)?.company ?? null;
          } catch { /* brochure pages fall back to neutral branding */ }
        }
        let sitePhotos: QuoteSitePhoto[] = [];
        try { sitePhotos = await loadQuoteSitePhotos(quoteId); } catch { /* optional section */ }
        if (!cancelled) setDoc({ sitePhotos, unitCards, brochureCompany, quote: qRes.data, customer, company: cRes.data ? { ...cRes.data, default_deposit_percentage: dRes.data?.default_deposit_percentage ?? cRes.data.default_deposit_percentage } : null, items, areas: buildClientRollup(lines, areaRows, { targetSubtotal: Number(qRes.data.subtotal) }) });
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
          customerVat={doc.customer?.vat_number}
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
          companyId={(q as any).company_id ?? null}
          paymentPlan={q.payment_plan ?? null}
          remoteQuote={!!(q as any).remote_quote}
          remoteQuoteSource={(q as any).remote_quote_source ?? null}
          relocationClause={(q as any).relocation_clause ?? null}
          quoteCreatedAt={q.created_at}
          unitCards={<><QuoteUnitCardsView cards={doc.unitCards} companyId={doc.quote?.company_id ?? (doc.company as any)?.company_id ?? null} variant={((doc.brochureCompany?.document_style ?? (doc.company as any)?.document_style) === "bold") ? "bold" : "light"} /><QuoteSitePhotosBlock photos={doc.sitePhotos} /></>}
        />
      )}
      {/* Model brochures are opened through the QR links, not appended. */}

    </div>
  );
};

export default ClientQuotePdfRoot;

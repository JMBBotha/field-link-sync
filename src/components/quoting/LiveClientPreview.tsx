import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import EstimateDocument, { type EstimateDocLineItem } from "./EstimateDocument";
import { QuoteUnitCardsView } from "./QuoteUnitCards";
import { buildUnitCards, unitLineModelKey, type ProductMedia } from "@/lib/unitCards";
import { buildClientRollup, clientDiscount, lineQtyText, rollupLineFromRow } from "@/lib/clientQuoteRollup";
import { useDocumentCompanyProfile } from "@/hooks/useDocumentCompanyProfile";
import { useDebounced } from "@/hooks/useLivePreviewPref";

/**
 * Live client preview (Johan 14 Oct 2026): the client-facing Light/Bold document, rendered from the
 * builder's IN-MEMORY quote state so it follows every edit. Read-only: only SELECTs, never writes.
 * Mirrors ClientQuotePdfRoot prop-for-prop; unit cards show APPROVED content only (same as the link).
 * The wrapper carries data-live-client-preview so PDF capture never picks it up.
 */
export interface LiveClientPreviewProps {
  quoteId: string;
  companyId?: string | null;
  quoteNumber: string;
  issueDate: string;
  validUntil?: string | null;
  customerName: string;
  customerCompany?: string | null;
  customerAddress?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerVat?: string | null;
  vatRate: number;
  notes?: string | null;
  termsText?: string | null;
  items: any[];
  areas: { id: string; name: string; sort_order?: number | null }[];
  discountType?: string | null;
  discountValue?: number | null;
  /** Uncommitted keystrokes from the editor, keyed by line id. */
  drafts?: Record<string, { item_name?: string; description?: string | null; unit_price?: number }>;
  className?: string;
  remoteQuote?: boolean | null;
  quoteCreatedAt?: string | null;
}

const DOC_WIDTH = 820;
const tidy = (v?: string | null) => (v || "").replace(/\s+/g, " ").trim();

export default function LiveClientPreview(props: LiveClientPreviewProps) {
  const snap = useDebounced({ items: props.items, areas: props.areas, drafts: props.drafts, dt: props.discountType, dv: props.discountValue }, 300);
  const { quoteId } = props;

  const productIds = useMemo(() => [...new Set(snap.items.map((i: any) => i.product_id).filter(Boolean))].sort() as string[], [snap.items]);
  const { data: products = {} } = useQuery({
    queryKey: ["live-preview-products", productIds.join(",")],
    enabled: productIds.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, image_url, category, brand, btu_rating, capacity_btu, kw, ai_sales_description, product_code")
        .in("id", productIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((p: any) => [p.id, p]));
    },
  });
  const { data: quoteExtra } = useQuery({
    queryKey: ["live-preview-quote", quoteId],
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await (supabase.from("quotes") as any).select("payment_plan, show_unit_cards").eq("id", quoteId).maybeSingle();
      return data || null;
    },
  });
  const { data: company } = useQuery({
    queryKey: ["live-preview-company-settings"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await (supabase.from("company_settings") as any)
        .select("company_name, physical_address, vat_number, banking_details, default_deposit_percentage, default_payment_terms_days")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(1)
        .maybeSingle();
      return data || null;
    },
  });
  const record = useDocumentCompanyProfile(props.companyId ?? null, null, !!props.companyId);

  const lines = useMemo(() => {
    const names = new Map(snap.areas.map((a) => [a.id, a.name]));
    return snap.items
      .filter((i: any) => !i.parent_item_id)
      .slice()
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((i: any) => {
        const d = snap.drafts?.[i.id];
        const row = d ? { ...i, ...d, total_price: d.unit_price != null ? Number(i.quantity || 0) * d.unit_price : i.total_price } : i;
        return rollupLineFromRow({ ...row, supplier_products: i.product_id ? (products as any)[i.product_id] : null }, names);
      });
  }, [snap, products]);

  const subtotal = useMemo(() => lines.reduce((s, l: any) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0), [lines]);
  const discount = clientDiscount(subtotal, snap.dt, snap.dv);
  const vat = Number(props.vatRate) || 0.15;
  const taxAmount = Math.round((subtotal - discount.amount) * vat * 100) / 100;
  const total = Math.round((subtotal - discount.amount) * (1 + vat) * 100) / 100;
  const areasRollup = useMemo(() => buildClientRollup(lines as any, snap.areas as any, { targetSubtotal: subtotal }), [lines, snap.areas, subtotal]);
  const docItems: EstimateDocLineItem[] = useMemo(() => lines.map((it: any) => {
    const name = it.item_name || it.description || "Item";
    const blurb = it.item_name ? it.description || null : null;
    const quantity = Number(it.quantity) || 0;
    const unit_price = Number(it.unit_price) || 0;
    return { description: blurb ? `${name}\n${blurb}` : name, quantity, unit_price, amount: Number(it.total_price) || quantity * unit_price, qtyText: lineQtyText(it), imageUrl: it.image_url || null };
  }), [lines]);

  const showCards = quoteExtra?.show_unit_cards !== false;
  const modelKeys = useMemo(() => (showCards ? [...new Set(lines.map((l: any) => unitLineModelKey(l)).filter(Boolean))].sort() as string[] : []), [lines, showCards]);
  const { data: media } = useQuery({
    queryKey: ["live-preview-media", modelKeys.join("|")],
    enabled: modelKeys.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("product_media" as never) as any).select("*").in("model_key", modelKeys);
      return new Map<string, ProductMedia>(((data || []) as ProductMedia[]).map((m) => [m.model_key, m]));
    },
  });
  // buildUnitCards keeps approved media only, so drafts show the plain fallback exactly like the client link.
  const unitCards = useMemo(() => (showCards && modelKeys.length ? buildUnitCards(lines as any, media ?? new Map()) : []), [lines, media, showCards, modelKeys.length]);
  const variant = (record as any)?.document_style === "bold" ? "bold" : "light";

  // Scale the A4-width document to fit the pane.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [docH, setDocH] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // Johan 15 Oct: scale up as well as down so the quote fills the whole pane, not just A4 width.
      setScale(box.clientWidth / DOC_WIDTH || 1);
      if (docRef.current) setDocH(docRef.current.offsetHeight);
    });
    ro.observe(box);
    if (docRef.current) ro.observe(docRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (docRef.current) setDocH(docRef.current.offsetHeight); });

  return (
    <div ref={boxRef} data-live-client-preview data-html2canvas-ignore data-pdf-hide className={`print:hidden ${props.className || ""}`} aria-label="Client view preview">
      <div style={{ height: docH ? docH * scale : undefined, overflow: "hidden" }}>
        <div ref={docRef} style={{ width: DOC_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} className="bg-white">
          <EstimateDocument
            estimateNumber={props.quoteNumber}
            issueDate={props.issueDate}
            validUntil={props.validUntil}
            customerName={tidy(props.customerName) || "Valued Customer"}
            customerCompany={props.customerCompany}
            customerAddress={props.customerAddress}
            customerEmail={props.customerEmail}
            customerPhone={props.customerPhone}
            customerVat={props.customerVat}
            items={docItems}
            presentationMode="clientRollup"
            clientAreas={areasRollup}
            subtotal={subtotal}
            taxRate={vat}
            taxAmount={taxAmount}
            grandTotal={total}
            notes={props.notes}
            termsText={props.termsText}
            discountAmount={discount.amount}
            discountLabel={discount.label}
            companyOverride={company}
            companyId={props.companyId ?? null}
            paymentPlan={quoteExtra?.payment_plan ?? null}
            remoteQuote={!!props.remoteQuote}
            quoteCreatedAt={props.quoteCreatedAt ?? null}
            unitCards={<QuoteUnitCardsView cards={unitCards} companyId={props.companyId ?? null} variant={variant} />}
          />
        </div>
      </div>
    </div>
  );
}

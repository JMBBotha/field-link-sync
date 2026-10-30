import { CUSTOMER_BILLTO_COLUMNS, resolveBillTo } from "@/lib/billTo";
import { useLivePreviewPref, useIsWideScreen } from "@/hooks/useLivePreviewPref";
import { useAuth } from "@/contexts/AuthContext";
import { CanonicalAreaCreateControl } from "@/components/quote/AreaNameChips";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import EstimateBuilder from "@/components/quoting/EstimateBuilder";
import type { PdfSelectedProduct } from "@/types/pdfSelection";


/**
 * Area-first PDF builder view: Step 1 "Create area" is the primary action, then each
 * area card carries ONE item search + one Add menu (EstimateBuilder areaFirst).
 * Edits the saved quote lines directly (same path as the estimate page).
 */
export default function AreaFirstBuilder({ pdfBasket }: { pdfBasket?: PdfSelectedProduct[] }) {
  const { quoteId, meta, areas, addArea } = useQuoteContext();
  const m: any = meta || {};
  // "Prepared for": quotes.customer_name, else the linked customer's name; number = quotes.quote_number.
  const { data: header } = useQuery({
    queryKey: ["quote-prepared-for", quoteId, m.customer_id ?? null],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data } = await (supabase.from("quotes") as any).select(`quote_number, customer_name, created_at, customers(${CUSTOMER_BILLTO_COLUMNS}), customer_locations!quotes_location_id_fkey(address), leads!quotes_lead_id_fkey(customer_address)`).eq("id", quoteId).maybeSingle();
      return data as any;
    },
  });
  const customerName = String(m.customer_name || header?.customer_name || header?.customers?.name || "").trim() || "Customer";
  // Bill-to = linked client's company record; lead/location address is only the Site line.
  const billTo = resolveBillTo({ customer: header?.customers ?? null, fallbackName: customerName, fallbackAddress: header?.leads?.customer_address ?? null });
  const quoteNumber = m.quote_number || header?.quote_number || "";
  const createAreaSection = (
      <section className="w-full print:hidden" data-html2canvas-ignore data-testid="create-area">
        <CanonicalAreaCreateControl existingNames={areas.map((area) => area.name)} onCreate={addArea} />
      </section>
  );

  const { user: livePreviewUser } = useAuth();
  const [livePreviewOpen] = useLivePreviewPref(livePreviewUser?.id ?? null);
  const livePreviewWide = useIsWideScreen() && livePreviewOpen;
  return (
    <div className={`mx-auto w-full ${livePreviewWide ? "max-w-[1760px]" : "max-w-4xl"} space-y-4 p-3 pb-24 sm:p-4`}>
      <EstimateBuilder
        areaFirst
        areaCreationControl={createAreaSection}
        pdfBasket={pdfBasket}
        quoteNumber={quoteNumber}
        issueDate={m.created_at ?? header?.created_at ?? new Date().toISOString()}
        validUntil={m.valid_until ?? null}
        customerName={customerName}
        customerCompany={billTo.company}
        customerAddress={billTo.address}
        customerEmail={header?.customers?.email ?? null}
        customerPhone={header?.customers?.phone ?? null}
        customerVat={billTo.vat}
        siteAddress={header?.customer_locations?.address || header?.leads?.customer_address || null}
        vatRate={Number(m.vat_rate) || 0.15}
        notes={m.notes ?? null}
        termsText={m.terms_text ?? null}
      />
    </div>
  );
}

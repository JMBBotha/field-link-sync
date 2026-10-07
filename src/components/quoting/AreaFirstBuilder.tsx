import { AreaCreateControl } from "@/components/quote/AreaNameChips";
import { useQuoteContext } from "@/contexts/QuoteContext";
import EstimateBuilder from "@/components/quoting/EstimateBuilder";
import type { PdfSelectedProduct } from "@/types/pdfSelection";


/**
 * Area-first PDF builder view: Step 1 "Create area" is the primary action, then each
 * area card carries ONE item search + one Add menu (EstimateBuilder areaFirst).
 * Edits the saved quote lines directly (same path as the estimate page).
 */
export default function AreaFirstBuilder({ pdfBasket }: { pdfBasket?: PdfSelectedProduct[] }) {
  const { meta, areas, addArea } = useQuoteContext();
  const m: any = meta || {};
  const createAreaSection = (
      <section className="w-full bg-card text-foreground" data-testid="create-area">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
          <h2 className="text-base font-semibold text-foreground">Create area</h2>
          <span className="ml-auto text-xs text-muted-foreground">{areas.length} area{areas.length === 1 ? "" : "s"}</span>
        </div>
        <AreaCreateControl existingNames={areas.map((area) => area.name)} onCreate={addArea} label="Create" />
        {areas.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">2.</span> In each area, search a model, size (12k / 12000) or name. Units add their install kit automatically.
          </p>
        )}
      </section>
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-3 pb-24 sm:p-4">
      <EstimateBuilder
        areaFirst
        areaCreationControl={createAreaSection}
        pdfBasket={pdfBasket}
        quoteNumber={m.quote_number ?? ""}
        issueDate={m.created_at ?? new Date().toISOString()}
        validUntil={m.valid_until ?? null}
        customerName={m.customer_name || "Customer"}
        customerCompany={null}
        customerAddress={m.customer_address ?? null}
        customerEmail={m.customer_email ?? null}
        customerPhone={m.customer_phone ?? null}
        vatRate={Number(m.vat_rate) || 0.15}
        notes={m.notes ?? null}
        termsText={m.terms_text ?? null}
      />
    </div>
  );
}

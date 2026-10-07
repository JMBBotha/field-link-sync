import { useState } from "react";
import { Plus, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuoteContext } from "@/contexts/QuoteContext";
import EstimateBuilder from "@/components/quoting/EstimateBuilder";
import type { PdfSelectedProduct } from "@/types/pdfSelection";

const QUICK_AREAS = ["Bedroom", "Lounge", "Kitchen", "Office"];

/**
 * Area-first PDF builder view: Step 1 "Create area" is the primary action, then each
 * area card carries ONE item search + one Add menu (EstimateBuilder areaFirst).
 * Edits the saved quote lines directly (same path as the estimate page).
 */
export default function AreaFirstBuilder({ pdfBasket }: { pdfBasket?: PdfSelectedProduct[] }) {
  const { meta, areas, addArea } = useQuoteContext();
  const m: any = meta || {};
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const nameFor = (base: string) => {
    const taken = new Set(areas.map((a) => a.name.trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
  };
  const create = async (base: string) => {
    const name = base.trim().slice(0, 60);
    if (!name || busy) return;
    setBusy(true);
    try { await addArea(nameFor(name)); setCustom(""); } finally { setBusy(false); }
  };

  const createAreaSection = (
      <section className="rounded-xl border-2 border-primary/30 bg-card p-3 shadow-sm sm:p-4" data-testid="create-area">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
          <h2 className="text-base font-semibold text-foreground">Create area</h2>
          <span className="ml-auto text-xs text-muted-foreground">{areas.length} area{areas.length === 1 ? "" : "s"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_AREAS.map((a) => (
            <Button key={a} type="button" size="lg" className="h-12 gap-1.5 text-sm" disabled={busy} onClick={() => void create(a)}>
              <Home className="h-4 w-4" />{a}
            </Button>
          ))}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(custom); }}>
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom area name (e.g. Main bedroom)" className="h-11" maxLength={60} />
          <Button type="submit" variant="outline" className="h-11 shrink-0 gap-1" disabled={!custom.trim() || busy}><Plus className="h-4 w-4" />Create</Button>
        </form>
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

import { Minus, Plus, X } from "lucide-react";
import type { PdfSelectedProduct } from "@/types/pdfSelection";
import { chosenTotal, jumpToQuoteLine, removeChosen, setChosenQty, type ChosenLineRef } from "@/lib/chosenItems";

const rands = (n: number) => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/\u00a0/g, ",")}`;

/** Items picked from the PDF price list. Qty/remove edit the basket only, never quote lines. */
export default function ChosenItemsList({ basket, onChange, refs, compact = false }: {
  basket: PdfSelectedProduct[];
  onChange: (next: PdfSelectedProduct[]) => void;
  refs: Record<string, ChosenLineRef[]>;
  compact?: boolean;
}) {
  if (!basket.length) {
    return <p className="py-6 text-center text-sm opacity-70" data-testid="chosen-empty">Nothing chosen yet. Tick items on the Visual PDF price list and they appear here.</p>;
  }
  const qty = basket.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
  return (
    <div data-testid="chosen-list" className="space-y-2">
      {basket.map((b) => {
        const hits = refs[b.code] ?? [];
        const model = b.productCode || [b.indoorModel, b.outdoorModel].filter(Boolean).join(" / ");
        return (
          <div key={b.code} data-testid="chosen-item" role={hits.length ? "button" : undefined} tabIndex={hits.length ? 0 : undefined}
            onClick={() => hits[0] && jumpToQuoteLine(hits[0].lineId)}
            onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) jumpToQuoteLine(hits[0].lineId); }}
            className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border border-[var(--fl-pane-bd,#DCE7F0)] bg-white ${compact ? "p-2" : "p-3"} ${hits.length ? "cursor-pointer hover:border-[var(--fl-b1,#1AA7EC)]" : ""}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-snug">{b.pdfDescription || b.description}</div>
              {model && <div className="font-mono text-xs opacity-70">{model}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                {hits.length ? hits.map((h) => (
                  <button key={h.lineId} type="button" data-testid="chosen-area-chip" onClick={(e) => { e.stopPropagation(); jumpToQuoteLine(h.lineId); }}
                    className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-[var(--fl-b2,#1590D6)]">↳ {h.areaName}</button>
                )) : <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700" data-testid="chosen-not-in-quote">Not in quote yet</span>}
              </div>
            </div>
            <div className="text-right" onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">{rands(parseFloat(b.price) || 0)}</div>
              <div className="mt-1.5 flex items-center justify-end gap-1">
                <div className="inline-flex items-center rounded-md border border-[var(--fl-pane-bd,#DCE7F0)]">
                  <button type="button" aria-label="Less" className="px-1.5 py-1" onClick={() => onChange(setChosenQty(basket, b.code, b.quantity - 1))}><Minus className="h-3 w-3" /></button>
                  <span className="min-w-[1.5rem] text-center text-sm" data-testid="chosen-qty">{b.quantity}</span>
                  <button type="button" aria-label="More" className="px-1.5 py-1" onClick={() => onChange(setChosenQty(basket, b.code, b.quantity + 1))}><Plus className="h-3 w-3" /></button>
                </div>
                <button type="button" aria-label="Remove from chosen" data-testid="chosen-remove" className="p-1 opacity-60 hover:opacity-100" onClick={() => onChange(removeChosen(basket, b.code))}><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex justify-between border-t border-[var(--fl-pane-bd,#DCE7F0)] pt-2 text-sm font-semibold" data-testid="chosen-total">
        <span>{basket.length} items · {qty} qty</span><span>{rands(chosenTotal(basket))} excl VAT</span>
      </div>
    </div>
  );
}

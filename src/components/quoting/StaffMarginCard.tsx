/**
 * StaffMarginCard — internal cost / markup / profit for the open quote.
 * Rendered OUTSIDE the pdf capture root and hidden on print: cost and profit
 * must never appear on the client-facing estimate.
 */
import { Card } from "@/components/ui/card";
import type { QuoteItem } from "@/types/quote";

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Cost snapshot stored on the line when it was added from the catalog. */
export const lineUnitCost = (item: QuoteItem): number => {
  const meta = (item.metadata || {}) as Record<string, any>;
  const raw = meta.unit_cost ?? meta.cost ?? meta.cost_price ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

interface Props {
  items: QuoteItem[];
  selectedId: string | null;
}

export default function StaffMarginCard({ items, selectedId }: Props) {
  const topLevel = items.filter((i) => !i.parent_item_id);
  const totalCost = topLevel.reduce((s, i) => s + Number(i.quantity || 0) * lineUnitCost(i), 0);
  const totalSell = topLevel.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
  const totalProfit = totalSell - totalCost;
  const totalMarkup = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const selected = topLevel.find((i) => i.id === selectedId) || null;
  const selCost = selected ? lineUnitCost(selected) : 0;
  const selSell = selected ? Number(selected.unit_price || 0) : 0;
  const selQty = selected ? Number(selected.quantity || 0) : 0;
  const selMarkup = selCost > 0 ? ((selSell - selCost) / selCost) * 100 : 0;
  const selProfit = (selSell - selCost) * selQty;

  return (
    <Card className="space-y-3 p-4 print:hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Staff only — cost &amp; margin</h2>
        <span className="text-[11px] text-muted-foreground">Never printed on the estimate</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">Total cost</p>
          <p className="font-semibold tabular-nums">{money(totalCost)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Total profit</p>
          <p className="font-semibold tabular-nums text-emerald-600">{money(totalProfit)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Markup</p>
          <p className="font-semibold tabular-nums">{totalMarkup.toFixed(1)}%</p>
        </div>
      </div>

      <div className="rounded-md border border-border p-3">
        {selected ? (
          <>
            <p className="truncate text-xs font-medium">{selected.item_name}</p>
            <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
              <div>
                <p className="text-[11px] text-muted-foreground">Cost</p>
                <p className="tabular-nums">{money(selCost)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">M/up</p>
                <p className="tabular-nums">{selCost > 0 ? `${selMarkup.toFixed(1)}%` : "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Sell</p>
                <p className="tabular-nums">{money(selSell)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Line profit</p>
                <p className="tabular-nums text-emerald-600">{money(selProfit)}</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Select a line on the quote to see its margin.</p>
        )}
      </div>
    </Card>
  );
}

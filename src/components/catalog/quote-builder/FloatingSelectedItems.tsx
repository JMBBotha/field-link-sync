import { useState, useRef, useCallback, useEffect } from "react";
import { calcSellingPrice } from "@/lib/pricing";
import { X, GripVertical, Minus, Maximize2, ChevronUp, ChevronDown, CheckCircle2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";

const normalizeMarkupPercent = (markupPercent?: number) => {
  if (markupPercent == null) return null;
  const numericMarkup = Number(markupPercent);
  if (!Number.isFinite(numericMarkup)) return null;
  return numericMarkup > 0 && numericMarkup <= 1 ? numericMarkup * 100 : numericMarkup;
};

const getMarkupAmount = (costPrice: number | undefined, markupPercent: number | undefined, sellingPrice: number) => {
  const normalizedMarkup = normalizeMarkupPercent(markupPercent);
  if (normalizedMarkup == null) return null;

  if (costPrice != null && Number.isFinite(Number(costPrice))) {
    return Number(costPrice) * (normalizedMarkup / 100);
  }

  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return 0;
  }

  return normalizedMarkup === 0 ? 0 : (sellingPrice * normalizedMarkup) / (100 + normalizedMarkup);
};

interface FloatingSelectedItemsProps {
  pdfSelection: PdfSelectionHandlers;
  onClose: () => void;
  /** Push all selected PDF products into the shared quote baskets */
  onAddSelectedToQuote?: () => void;
}

const FloatingSelectedItems = ({ pdfSelection, onClose, onAddSelectedToQuote }: FloatingSelectedItemsProps) => {
  const [pos, setPos] = useState({ x: window.innerWidth - 340, y: 80 });
  const [minimized, setMinimized] = useState(false);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const items = pdfSelection.selectedFromPdf;
  const total = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * i.quantity, 0);

  return (
    <div
      className="fixed z-[9999] rounded-xl border bg-card shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: minimized ? 200 : 300 }}
    >
      {/* Drag handle + header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-xl cursor-grab active:cursor-grabbing select-none"
        style={{ backgroundColor: "hsl(var(--primary))" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical className="h-3.5 w-3.5 text-primary-foreground/70" />
        <span className="text-xs font-semibold text-primary-foreground flex-1">
          Selected Items
        </span>
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-primary-foreground/20 text-primary-foreground border-0">
          {items.length}
        </Badge>
        {items.length > 0 && (
          <button
            onClick={() => pdfSelection.setSelectedFromPdf([])}
            className="text-[10px] font-medium text-primary-foreground/70 hover:text-primary-foreground"
            title="Clear all selected items"
          >
            Clear
          </button>
        )}
        <button onClick={() => setMinimized(!minimized)} className="text-primary-foreground/70 hover:text-primary-foreground">
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onClose} className="text-primary-foreground/70 hover:text-primary-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!minimized && (
        <div className="p-2 max-h-72 overflow-y-auto space-y-1.5">
          {items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic text-center py-4">
              Select products from PDF view
            </p>
          ) : (
            items.map((item) => {
              const normalizedMarkup = normalizeMarkupPercent(item.markupPercent);
              const sellingPrice = parseFloat(item.price) || 0;
              const markupAmount = getMarkupAmount(item.costPrice, item.markupPercent, sellingPrice);

              return (
              <div key={item.code} className="bg-muted/50 p-2 rounded-md space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <button
                      onClick={() => pdfSelection.handleSelectProduct(item)}
                      className="shrink-0 flex items-center justify-center rounded-full transition-colors hover:scale-110"
                      title="Unselect item"
                    >
                      <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(var(--success))" }} />
                    </button>
                    <p className="text-[11px] font-medium text-foreground truncate flex-1">{item.code}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                {(item.indoorModel || item.outdoorModel || item.btu || item.kw) && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground">
                    {item.indoorModel && (
                      <span>Indoor: <span className="font-mono text-foreground">{item.indoorModel}</span></span>
                    )}
                    {item.outdoorModel && (
                      <span>Outdoor: <span className="font-mono text-foreground">{item.outdoorModel}</span></span>
                    )}
                    {item.btu && (
                      <span>BTU: <span className="font-mono text-foreground">{item.btu}</span></span>
                    )}
                    {item.kw && (
                      <span>kW: <span className="font-mono text-foreground">{item.kw}</span></span>
                    )}
                  </div>
                )}
                {/* Cost & Markup row with adjustment controls */}
                {(item.costPrice != null || item.markupPercent != null) && (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {item.costPrice != null && (
                      <span>Cost: <span className="font-mono font-medium text-foreground">R{Number(item.costPrice).toFixed(2)}</span></span>
                    )}
                    {normalizedMarkup != null && item.costPrice != null && (
                      <div className="flex items-center gap-0.5">
                        <span>M/Up:</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-4 w-4"
                          onClick={() => {
                            const cost = Number(item.costPrice);
                            const newMarkup = Math.max(0, (normalizedMarkup || 0) - 5);
                            const { sellingExclVat } = calcSellingPrice(cost, newMarkup);
                            pdfSelection.updateSelectedItem(item.code, { markupPercent: newMarkup, price: String(Math.round(sellingExclVat * 100) / 100) } as any);
                          }}
                        >
                          <ChevronDown className="h-2.5 w-2.5" />
                        </Button>
                        <span className="font-mono font-semibold text-primary min-w-[32px] text-center">{normalizedMarkup.toFixed(1)}%</span>
                        {markupAmount != null && (
                          <span className="font-mono text-[9px] text-foreground ml-0.5">
                            (R{markupAmount.toFixed(2)})
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-4 w-4"
                          onClick={() => {
                            const cost = Number(item.costPrice);
                            const newMarkup = (normalizedMarkup || 0) + 5;
                            const { sellingExclVat } = calcSellingPrice(cost, newMarkup);
                            pdfSelection.updateSelectedItem(item.code, { markupPercent: newMarkup, price: String(Math.round(sellingExclVat * 100) / 100) } as any);
                          }}
                        >
                          <ChevronUp className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    )}
                    {normalizedMarkup != null && item.costPrice == null && (
                      <span>
                        M/Up: <span className="font-mono font-medium text-foreground">{normalizedMarkup.toFixed(1)}%</span>
                        {markupAmount != null && <span className="font-mono text-foreground"> (R{markupAmount.toFixed(2)})</span>}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <select
                    value={item.unitType}
                    onChange={(e) => pdfSelection.updateSelectedItem(item.code, { unitType: e.target.value })}
                    className="h-6 text-[10px] rounded border border-input bg-background px-1"
                  >
                    <option value="units">Units</option>
                    <option value="meters">Meters</option>
                  </select>
                  <Input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={item.quantity}
                    onChange={(e) => pdfSelection.updateSelectedItem(item.code, { quantity: Math.max(0.1, Number(e.target.value)) })}
                    className="h-6 w-16 text-[10px] px-1"
                  />
                  <div className="flex flex-col items-end ml-auto">
                    <span className="text-[10px] font-medium text-foreground">
                      R{((parseFloat(item.price) || 0) * item.quantity).toFixed(2)} <span className="text-[8px] text-muted-foreground">excl</span>
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      R{((parseFloat(item.price) || 0) * item.quantity * 1.15).toFixed(2)} incl
                    </span>
                  </div>
                </div>
              </div>
            )})
          )}
        </div>
      )}

      {/* Total footer */}
      {!minimized && items.length > 0 && (
        <div className="border-t px-3 py-2 space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Total (excl VAT)</span>
            <span className="text-sm font-bold text-foreground">R{total.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Total (incl VAT)</span>
            <span className="text-xs font-semibold text-muted-foreground">R{(total * 1.15).toFixed(2)}</span>
          </div>
          {onAddSelectedToQuote && (
            <Button className="w-full h-8 mt-1.5 gap-1.5 text-xs" onClick={onAddSelectedToQuote}>
              <Plus className="h-3.5 w-3.5" />
              Add {items.length} to quote
            </Button>
          )}
        </div>
      )}

      {minimized && items.length > 0 && (
        <div className="px-3 py-1.5">
          <span className="text-xs font-bold text-foreground">R{total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
};

export default FloatingSelectedItems;

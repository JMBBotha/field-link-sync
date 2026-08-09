import { useState, useCallback, memo } from "react";
import { X, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface QuoteItemData {
  item_name: string;
  item_number: string;
  description: string;
  unit_price: number;
  quantity: number;
  notes: string;
  source: "catalog" | "manual";
  supplier: string;
  product_id?: string;
}

interface QuoteItemPopupProps {
  open: boolean;
  onClose: () => void;
  onAdd: (item: QuoteItemData) => void;
  /** Pre-filled data from a matched catalog product */
  prefill?: Partial<QuoteItemData>;
  supplierName?: string;
}

const QuoteItemPopup = memo(({ open, onClose, onAdd, prefill, supplierName }: QuoteItemPopupProps) => {
  const [itemName, setItemName] = useState(prefill?.item_name || "");
  const [itemNumber, setItemNumber] = useState(prefill?.item_number || "");
  const [description, setDescription] = useState(prefill?.description || "");
  const [unitPrice, setUnitPrice] = useState(prefill?.unit_price?.toString() || "");
  const [quantity, setQuantity] = useState(prefill?.quantity?.toString() || "1");
  const [notes, setNotes] = useState(prefill?.notes || "");

  const handleAdd = useCallback(() => {
    const data: QuoteItemData = {
      item_name: itemName.trim() || "Unnamed Item",
      item_number: itemNumber.trim(),
      description: description.trim(),
      unit_price: parseFloat(unitPrice) || 0,
      quantity: parseFloat(quantity) || 1,
      notes: notes.trim(),
      source: prefill?.product_id ? "catalog" : "manual",
      supplier: supplierName || prefill?.supplier || "",
      product_id: prefill?.product_id,
    };
    onAdd(data);
  }, [itemName, itemNumber, description, unitPrice, quantity, notes, prefill, supplierName, onAdd]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-popover border rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card text-foreground">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              {prefill?.product_id ? "Add to Quote" : "Manual Item Entry"}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Item Name</Label>
              <Input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Copper Pipe 6.35mm"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Item Number</Label>
              <Input
                value={itemNumber}
                onChange={(e) => setItemNumber(e.target.value)}
                placeholder="e.g. CP-635"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Product description or special instructions..."
              className="text-xs min-h-[60px] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Unit Price (excl VAT)</Label>
              <Input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
                className="h-8 text-xs"
                step="0.01"
                min="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quantity</Label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
                className="h-8 text-xs"
                step="1"
                min="1"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Custom notes, special requirements..."
              className="text-xs min-h-[50px] resize-none"
            />
          </div>

          {/* Line total preview */}
          <div className="flex flex-col gap-1 pt-2 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Line Total (excl VAT)</span>
              <span className="text-sm font-bold text-foreground">
                R{((parseFloat(unitPrice) || 0) * (parseFloat(quantity) || 1)).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Line Total (incl 15% VAT)</span>
              <span className="text-xs font-semibold text-muted-foreground">
                R{((parseFloat(unitPrice) || 0) * (parseFloat(quantity) || 1) * 1.15).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {prefill?.product_id && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Markup</span>
                <span className="text-xs font-semibold text-primary">
                  {(prefill as any)?.default_markup_percent ?? (prefill as any)?.markup_percent ?? "—"}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-card text-foreground">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleAdd} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add to Quote
          </Button>
        </div>
      </div>
    </div>
  );
});

QuoteItemPopup.displayName = "QuoteItemPopup";
export default QuoteItemPopup;

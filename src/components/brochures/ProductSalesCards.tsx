import { useMemo, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveAr40SalesCards, type SalesCard } from "@/lib/ar40SalesCards";

interface ProductSalesCardsProps {
  /** Product codes of the current quote line items. */
  lineItemModelCodes: string[];
}

/**
 * Shows the per-SKU sales card art for AR40 lines on a quote.
 * Art only — no prices are rendered here.
 */
const ProductSalesCards = ({ lineItemModelCodes }: ProductSalesCardsProps) => {
  const cards = useMemo(() => resolveAr40SalesCards(lineItemModelCodes), [lineItemModelCodes]);
  const [preview, setPreview] = useState<SalesCard | null>(null);

  if (cards.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Sales Cards
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {cards.map((card) => (
          <button
            key={card.code + (card.isFamilyFallback ? "-family" : "")}
            type="button"
            onClick={() => setPreview(card)}
            className="group rounded-md border border-border overflow-hidden bg-muted/30 text-left"
          >
            <img
              src={card.url}
              alt={`${card.label} sales card`}
              loading="lazy"
              className="w-full h-auto object-contain transition-transform group-hover:scale-[1.02]"
            />
            <span className="block px-2 py-1 text-[10px] truncate text-muted-foreground">
              {card.label}
            </span>
          </button>
        ))}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{preview?.label}</DialogTitle>
          </DialogHeader>
          {preview && (
            <img
              src={preview.url}
              alt={`${preview.label} sales card`}
              className="w-full h-auto rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductSalesCards;

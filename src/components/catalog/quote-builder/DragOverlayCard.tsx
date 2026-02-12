import type { PaletteProduct } from "../QuoteBuilderTab";
import { getCategoryIcon, getCategoryBg } from "./ProductPalette";
import { Badge } from "@/components/ui/badge";
import { getProductDisplayName } from "./productDisplayUtils";

const DragOverlayCard = ({ product }: { product: PaletteProduct }) => {
  const price = product.selling_price || product.cost_incl_vat || 0;
  const catBg = getCategoryBg(product.product_category);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 shadow-xl w-72 opacity-95">
      <div className={`shrink-0 rounded-md p-1.5 ${catBg}`}>
        {getCategoryIcon(product.product_category, "h-4 w-4")}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">
          {getProductDisplayName(product)}
        </p>
        <p className="text-[10px] font-mono font-medium truncate text-primary/80">{product.product_code}</p>
      </div>
      <Badge variant="secondary" className="text-xs font-bold shrink-0">
        {price > 0 ? `R${price.toLocaleString("en-ZA")}` : "POR"}
      </Badge>
    </div>
  );
};

export default DragOverlayCard;

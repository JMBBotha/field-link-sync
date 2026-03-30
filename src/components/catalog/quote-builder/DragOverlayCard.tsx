import type { PaletteProduct } from "../QuoteBuilderTab";
import { getCategoryIcon, getCategoryBg } from "./ProductPalette";
import { Badge } from "@/components/ui/badge";
import { getProductDisplayName } from "./productDisplayUtils";
import { computePricing, resolveSupplierCode } from "@/lib/pricing";

const DragOverlayCard = ({ product }: { product: PaletteProduct }) => {
  const listPrice = product.cost_excl_vat || 0;
  const markupPct = product.default_markup_percent ?? product.markup_percent ?? 20;
  const computed = computePricing(resolveSupplierCode(product.supplier_name), listPrice, markupPct, product.cost_price || null);
  const price = computed.sellExVat;
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

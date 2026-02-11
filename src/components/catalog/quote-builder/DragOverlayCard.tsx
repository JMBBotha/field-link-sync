import { Snowflake, Droplets, Zap, BatteryCharging, Wrench, Package } from "lucide-react";
import type { PaletteProduct } from "../QuoteBuilderTab";

const DragOverlayCard = ({ product }: { product: PaletteProduct }) => {
  const categoryIcon = () => {
    switch (product.product_category) {
      case "Air Conditioning": return <Snowflake className="h-4 w-4 text-primary" />;
      case "Water Heaters": return <Droplets className="h-4 w-4 text-blue-500" />;
      case "Inverters": return <Zap className="h-4 w-4 text-amber-500" />;
      case "Batteries": return <BatteryCharging className="h-4 w-4 text-green-600" />;
      case "Consumables": return <Wrench className="h-4 w-4 text-orange-500" />;
      default: return <Package className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const price = product.selling_price || product.cost_incl_vat || 0;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card p-2 shadow-xl w-64 opacity-90">
      {categoryIcon()}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">
          {product.brand} {product.short_name || product.model_number}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">{product.model_number}</p>
      </div>
      <span className="text-xs font-semibold text-foreground whitespace-nowrap">
        R{price.toLocaleString("en-ZA")}
      </span>
    </div>
  );
};

export default DragOverlayCard;

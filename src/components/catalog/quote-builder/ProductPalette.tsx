import { useDraggable } from "@dnd-kit/core";
import { Search, Snowflake, Droplets, Zap, BatteryCharging, Wrench, Package, GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PaletteProduct } from "../QuoteBuilderTab";

const CATEGORIES = [
  { value: "all", label: "All", icon: Package },
  { value: "Air Conditioning", label: "AC", icon: Snowflake },
  { value: "Water Heaters", label: "Geyser", icon: Droplets },
  { value: "Inverters", label: "Inverter", icon: Zap },
  { value: "Batteries", label: "Battery", icon: BatteryCharging },
  { value: "Consumables", label: "Parts", icon: Wrench },
];

interface ProductPaletteProps {
  products: PaletteProduct[];
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categoryFilter: string;
  onCategoryChange: (c: string) => void;
}

function DraggableProductCard({ product }: { product: PaletteProduct }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: product.id,
  });

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
    <HoverCard openDelay={400} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          className={`flex items-center gap-2 rounded-md border bg-card p-2 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md ${
            isDragging ? "opacity-40 shadow-lg" : ""
          } ${product.is_pinned ? "border-primary/30" : ""}`}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <div className="shrink-0">{categoryIcon()}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">
              {product.brand || ""} {product.short_name || product.model_number}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">{product.model_number}</p>
          </div>
          <span className="text-xs font-semibold text-foreground whitespace-nowrap">
            {price > 0 ? `R${price.toLocaleString("en-ZA")}` : "POR"}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-64 text-xs space-y-1.5">
        <p className="font-semibold">{product.brand} {product.short_name || product.model_number}</p>
        <p className="text-muted-foreground">{product.model_number}</p>
        <div className="flex justify-between">
          <span>Cost excl.</span>
          <span className="font-medium">R{(product.cost_excl_vat || 0).toLocaleString("en-ZA")}</span>
        </div>
        <div className="flex justify-between">
          <span>Cost incl.</span>
          <span className="font-medium">R{(product.cost_incl_vat || 0).toLocaleString("en-ZA")}</span>
        </div>
        <div className="flex justify-between">
          <span>Selling</span>
          <span className="font-bold">R{(product.selling_price || 0).toLocaleString("en-ZA")}</span>
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-3">{product.description}</p>
        <Badge variant="outline" className="text-[10px]">{product.supplier_name}</Badge>
      </HoverCardContent>
    </HoverCard>
  );
}

const ProductPalette = ({
  products,
  isLoading,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
}: ProductPaletteProps) => {
  // Group products: pinned first, then by category
  const grouped = products.reduce<Record<string, PaletteProduct[]>>((acc, p) => {
    const key = p.product_category || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div className="flex flex-col rounded-lg border bg-card overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Product Palette</h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = categoryFilter === cat.value;
            return (
              <Badge
                key={cat.value}
                variant={isActive ? "default" : "outline"}
                className="cursor-pointer text-[10px] gap-0.5 px-1.5 py-0.5"
                onClick={() => onCategoryChange(cat.value)}
              >
                <Icon className="h-2.5 w-2.5" />
                {cat.label}
              </Badge>
            );
          })}
        </div>
      </div>

      {/* Product list */}
      <ScrollArea className="flex-1" style={{ maxHeight: 420 }}>
        <div className="p-2 space-y-3">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))
          ) : products.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No products found</p>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                  {category} ({items.length})
                </p>
                <div className="space-y-1">
                  {items.map((product) => (
                    <DraggableProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProductPalette;

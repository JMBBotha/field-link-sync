import { useMemo } from "react";
import { Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaletteProduct, BasketItem } from "../QuoteBuilderTab";

interface ConsumablesSuggestionPanelProps {
  basketItems: BasketItem[];
  allProducts: PaletteProduct[];
  onAddProduct: (product: PaletteProduct) => void;
}

const CONSUMABLE_KEYWORDS = [
  { label: "Copper Pipe", keywords: ["copper", "pipe", "piping"] },
  { label: "Electrical Cable", keywords: ["cable", "electrical", "wire"] },
  { label: "Drain Pipe", keywords: ["drain", "condensate"] },
  { label: "Brackets", keywords: ["bracket", "mount", "mounting"] },
  { label: "Trunking", keywords: ["trunking", "trunk", "duct"] },
  { label: "Insulation", keywords: ["insulation", "lagging", "armaflex"] },
  { label: "Tape", keywords: ["tape", "pvc tape"] },
  { label: "Fittings", keywords: ["fitting", "flare", "coupling", "elbow"] },
];

const ConsumablesSuggestionPanel = ({ basketItems, allProducts, onAddProduct }: ConsumablesSuggestionPanelProps) => {
  const hasACUnit = basketItems.some(
    (i) => i.product.product_category === "Air Conditioning"
  );

  const suggestedProducts = useMemo(() => {
    if (!hasACUnit) return [];

    const consumables = allProducts.filter(
      (p) => p.product_category === "Consumables" || (p.category || "").toLowerCase().includes("consumable")
    );

    const existingIds = new Set(basketItems.map((i) => i.product.id));
    const suggestions: { product: PaletteProduct; label: string }[] = [];
    const addedIds = new Set<string>();

    for (const group of CONSUMABLE_KEYWORDS) {
      const match = consumables.find((p) => {
        if (addedIds.has(p.id) || existingIds.has(p.id)) return false;
        const blob = `${p.description || ""} ${p.short_name || ""} ${p.product_code || ""} ${p.category || ""}`.toLowerCase();
        return group.keywords.some((kw) => blob.includes(kw));
      });
      if (match) {
        suggestions.push({ product: match, label: group.label });
        addedIds.add(match.id);
      }
    }
    return suggestions;
  }, [hasACUnit, allProducts, basketItems]);

  if (!hasACUnit || suggestedProducts.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed border-orange-400/40 bg-orange-500/5 p-2 mt-1.5">
      <p className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 flex items-center gap-1 mb-1.5">
        <Wrench className="h-3 w-3" />
        Suggested Consumables
      </p>
      <div className="flex flex-wrap gap-1">
        {suggestedProducts.map(({ product, label }) => {
          const price = product.selling_price || product.cost_incl_vat || 0;
          return (
            <Button
              key={product.id}
              variant="outline"
              size="sm"
              className="h-auto py-1 px-2 text-[10px] gap-1 border-orange-400/30 hover:bg-orange-500/10"
              onClick={() => onAddProduct(product)}
            >
              <Plus className="h-2.5 w-2.5" />
              {label}
              {price > 0 && <span className="text-muted-foreground">R{price.toLocaleString("en-ZA")}</span>}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

export default ConsumablesSuggestionPanel;

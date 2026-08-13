import { useState, useMemo } from "react";
import { calcSellingPrice, applyDiscount } from "@/lib/pricing";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Percent, Undo2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const BrandDiscountsSection = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [discountPct, setDiscountPct] = useState<string>("");
  const queryClient = useQueryClient();

  // Get distinct brands from products
  const { data: brands = [] } = useQuery({
    queryKey: ["distinct-brands"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("brand")
        .or("archived.is.null,archived.eq.false")
        .not("brand", "is", null);
      if (error) throw error;
      const unique = [...new Set((data || []).map((r: any) => r.brand).filter(Boolean))] as string[];
      return unique.sort();
    },
  });

  // Get brand product counts
  const { data: brandCounts = {} } = useQuery({
    queryKey: ["brand-product-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("brand")
        .or("archived.is.null,archived.eq.false")
        .not("brand", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        if (r.brand) counts[r.brand] = (counts[r.brand] || 0) + 1;
      });
      return counts;
    },
  });

  // Get active brand discounts
  const { data: activeDiscounts = [] } = useQuery({
    queryKey: ["brand-discounts"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("brand_discounts") as any)
        .select("*")
        .order("brand");
      if (error) throw error;
      return data as { id: string; brand: string; discount_percentage: number; applied_at: string }[];
    },
  });

  const activeDiscountMap = useMemo(() => {
    const map: Record<string, { id: string; discount_percentage: number }> = {};
    activeDiscounts.forEach((d) => { map[d.brand] = d; });
    return map;
  }, [activeDiscounts]);

  const selectedCount = brandCounts[selectedBrand] || 0;
  const parsedDiscount = Math.min(100, Math.max(0, parseFloat(discountPct) || 0));

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBrand || parsedDiscount <= 0) throw new Error("Select brand and discount");

      // Get all products of this brand
      const { data: products, error: fetchErr } = await (supabase.from("supplier_products") as any)
        .select("id, cost_excl_vat, original_cost_excl_vat, default_markup_percent")
        .eq("brand", selectedBrand)
        .or("archived.is.null,archived.eq.false");
      if (fetchErr) throw fetchErr;

      // Update each product
      for (const p of (products || [])) {
        const origCost = p.original_cost_excl_vat ?? p.cost_excl_vat;
        const newCostPrice = applyDiscount(origCost, parsedDiscount);

        const { error } = await (supabase.from("supplier_products") as any)
          .update({
            original_cost_excl_vat: origCost,
            cost_price: newCostPrice,
            cost_excl_vat: newCostPrice,
          })
          .eq("id", p.id);
        if (error) throw error;
      }

      // Upsert brand_discounts record
      const { error: upsertErr } = await (supabase.from("brand_discounts") as any)
        .upsert({
          brand: selectedBrand,
          discount_percentage: parsedDiscount,
          applied_at: new Date().toISOString(),
        }, { onConflict: "brand" });
      if (upsertErr) throw upsertErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-discounts"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["product-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["brand-product-counts"] });
      toast.success(`${parsedDiscount}% discount applied to ${selectedBrand}`);
      setDiscountPct("");
    },
    onError: (e: any) => toast.error(e.message || "Failed to apply discount"),
  });

  const revertMutation = useMutation({
    mutationFn: async (brand: string) => {
      // Get products with original cost
      const { data: products, error: fetchErr } = await (supabase.from("supplier_products") as any)
        .select("id, original_cost_excl_vat, default_markup_percent")
        .eq("brand", brand)
        .not("original_cost_excl_vat", "is", null);
      if (fetchErr) throw fetchErr;

      for (const p of (products || [])) {
        const { error } = await (supabase.from("supplier_products") as any)
          .update({
            cost_price: p.original_cost_excl_vat,
            cost_excl_vat: p.original_cost_excl_vat,
            original_cost_excl_vat: null,
          })
          .eq("id", p.id);
        if (error) throw error;
      }

      // Delete brand_discounts row
      const { error: delErr } = await (supabase.from("brand_discounts") as any)
        .delete()
        .eq("brand", brand);
      if (delErr) throw delErr;
    },
    onSuccess: (_data, brand) => {
      queryClient.invalidateQueries({ queryKey: ["brand-discounts"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["product-catalog"] });
      toast.success(`Discount reverted for ${brand}`);
    },
    onError: (e: any) => toast.error(e.message || "Failed to revert discount"),
  });

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between text-xs gap-1.5 h-8">
          <span className="flex items-center gap-1.5">
            <Percent className="h-3.5 w-3.5" />
            Brand Discounts
            {activeDiscounts.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {activeDiscounts.length} active
              </Badge>
            )}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="rounded-lg border bg-card p-3 space-y-3">
          {/* Active discounts */}
          {activeDiscounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeDiscounts.map((d) => (
                <Badge
                  key={d.id}
                  variant="secondary"
                  className="gap-1 text-[10px] pr-1"
                >
                  {d.brand}: {d.discount_percentage}% off
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-0.5 hover:bg-destructive/20"
                    onClick={() => revertMutation.mutate(d.brand)}
                    disabled={revertMutation.isPending}
                  >
                    <Undo2 className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}

          {/* Apply new discount */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Brand</label>
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select brand" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b} value={b} className="text-xs">
                      {b} ({brandCounts[b] || 0})
                      {activeDiscountMap[b] && (
                        <span className="ml-1 text-primary">• {activeDiscountMap[b].discount_percentage}%</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-20">
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Discount %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                placeholder="0"
                className="h-8 text-xs"
              />
            </div>
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              disabled={!selectedBrand || parsedDiscount <= 0 || applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
            >
              {applyMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Percent className="h-3 w-3" />
              )}
              Apply
            </Button>
          </div>

          {/* Preview */}
          {selectedBrand && parsedDiscount > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {selectedBrand}: {selectedCount} products, {parsedDiscount}% off cost
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default BrandDiscountsSection;

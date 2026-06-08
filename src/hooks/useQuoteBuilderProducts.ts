import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

export function useQuoteBuilderProducts() {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["quote-builder-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products")
        .select(`
          id, product_code, short_name, brand, product_category, category,
          cost_excl_vat, cost_incl_vat, cost_price, default_markup_percent,
          selling_price, description, is_pinned, pin_order, price_per_metre,
          sold_in_length, unit_length, pipe_size, is_material_favorite,
          suggested_consumables, pack_qty, supplier_discount_percent,
          markup_percent, btu_rating,
          suppliers(name, supplier_type)
        `)
        .or("archived.is.null,archived.eq.false")
        .order("is_pinned", { ascending: false })
        .order("pin_order", { ascending: true, nullsFirst: false })
        .limit(2000);

      if (error) throw error;

      return ((data || []) as unknown as Array<Record<string, unknown> & {
        product_category?: string;
        category?: string;
        suppliers?: { name?: string; supplier_type?: string } | null;
        price_per_metre?: number | null;
        sold_in_length?: boolean | null;
        unit_length?: number | null;
        pipe_size?: string | null;
        is_material_favorite?: boolean | null;
        pack_qty?: number | null;
        cost_price?: number | null;
        default_markup_percent?: number | null;
      }>).map((p) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
        supplier_type: p.suppliers?.supplier_type || "both",
        price_per_metre: p.price_per_metre || null,
        sold_in_length: p.sold_in_length || false,
        unit_length: p.unit_length || null,
        pipe_size: p.pipe_size || null,
        is_material_favorite: p.is_material_favorite || false,
        pack_qty: p.pack_qty || null,
        cost_price: p.cost_price ?? 0,
        default_markup_percent: p.default_markup_percent ?? 35,
      }));
    },
  });

  return { products, isLoading };
}
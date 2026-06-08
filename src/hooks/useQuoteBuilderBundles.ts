import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteBundle } from "@/components/catalog/quote-builder/ProductPalette";

export function useQuoteBuilderBundles() {
  const { data: bundles = [], isLoading: bundlesLoading } = useQuery<PaletteBundle[]>({
    queryKey: ["quote-builder-bundles"],
    queryFn: async () => {
      const { data: bundleData, error: bErr } = await supabase
        .from("installation_bundles")
        .select("id, name, description, bundle_type, min_btu, max_btu, compatible_brands, is_favorite")
        .eq("is_active", true)
        .order("name");

      if (bErr) throw bErr;
      if (!bundleData || bundleData.length === 0) return [];

      const { data: itemsData, error: iErr } = await supabase
        .from("bundle_items")
        .select(`
          id, bundle_id, supplier_product_id, quantity, length_metres,
          is_length_item, is_optional, sort_order,
          supplier_products(
            id, product_code, short_name, brand, product_category, category,
            cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned,
            pin_order, price_per_metre, sold_in_length, unit_length,
            suppliers(name)
          )
        `)
        .order("sort_order");

      if (iErr) throw iErr;

      interface BundleItemRow {
        id: string;
        bundle_id: string;
        supplier_product_id: string;
        quantity: number;
        length_metres: number | null;
        is_length_item: boolean | null;
        is_optional: boolean | null;
        sort_order: number | null;
        supplier_products: {
          id: string;
          product_code: string | null;
          short_name: string | null;
          brand: string | null;
          product_category: string | null;
          category: string | null;
          cost_excl_vat: number | null;
          cost_incl_vat: number | null;
          selling_price: number | null;
          description: string | null;
          is_pinned: boolean | null;
          pin_order: number | null;
          price_per_metre: number | null;
          sold_in_length: boolean | null;
          unit_length: number | null;
          suppliers: { name: string | null } | null;
        } | null;
      }

      const itemsByBundle: Record<string, unknown[]> = {};
      ((itemsData as unknown as BundleItemRow[]) || []).forEach((item) => {
        if (!itemsByBundle[item.bundle_id]) itemsByBundle[item.bundle_id] = [];
        const sp = item.supplier_products;
        itemsByBundle[item.bundle_id].push({
          id: item.id,
          supplier_product_id: item.supplier_product_id,
          quantity: item.quantity,
          length_metres: item.length_metres,
          is_length_item: item.is_length_item,
          is_optional: item.is_optional || false,
          product: sp ? {
            ...sp,
            product_category: sp.product_category || sp.category || "",
            supplier_name: sp.suppliers?.name || "",
            price_per_metre: sp.price_per_metre || null,
            sold_in_length: sp.sold_in_length || false,
            unit_length: sp.unit_length || null
          } : null,
        });
      });

      return bundleData.map((b) => ({
        ...b,
        items: itemsByBundle[b.id] || []
      }));
    },
    staleTime: 60000,
  });

  return { bundles, bundlesLoading };
}
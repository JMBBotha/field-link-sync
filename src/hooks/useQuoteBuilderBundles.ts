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
        supplier_products: Record<string, unknown> | null;
      }

      const itemsByBundle: Record<string, PaletteBundle["items"]> = {};
      ((itemsData as unknown as BundleItemRow[]) || []).forEach((item) => {
        if (!itemsByBundle[item.bundle_id]) itemsByBundle[item.bundle_id] = [];
        const sp = item.supplier_products as Record<string, unknown> | null;
        const product = sp
          ? ({
              ...sp,
              product_category: (sp.product_category as string) || (sp.category as string) || "",
              supplier_name: (sp.suppliers as { name?: string } | null)?.name || "",
              price_per_metre: (sp.price_per_metre as number | null) || null,
              sold_in_length: (sp.sold_in_length as boolean) || false,
              unit_length: (sp.unit_length as number | null) || null,
            } as unknown as PaletteBundle["items"][number]["product"])
          : (null as unknown as PaletteBundle["items"][number]["product"]);
        itemsByBundle[item.bundle_id].push({
          id: item.id,
          supplier_product_id: item.supplier_product_id,
          quantity: item.quantity,
          length_metres: item.length_metres as number,
          is_length_item: item.is_length_item as boolean,
          is_optional: item.is_optional || false,
          product,
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
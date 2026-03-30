import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CAPACITY_TIER_CONFIGS } from "@/lib/bundleTierConfig";

type BundleProductMap = Record<string, any>;

export function useBundleProducts() {
  const [bundleProducts, setBundleProducts] = useState<BundleProductMap>({});

  const allCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const config of CAPACITY_TIER_CONFIGS) {
      for (const tier of config.tiers) {
        for (const line of tier.lines) {
          const code = (line.productCode || "").trim().toUpperCase();
          if (code) codes.add(code);
        }
      }
    }
    return Array.from(codes);
  }, []);

  useEffect(() => {
    let active = true;

    const loadBundleProducts = async () => {
      if (allCodes.length === 0) return;

      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, pack_qty, default_markup_percent, btu_rating, suppliers(name, supplier_type)")
        .eq("is_active", true)
        .or("archived.is.null,archived.eq.false")
        .in("product_code", allCodes)
        .limit(2000);

      if (error) {
        console.error("[AutoBundle] failed to load bundle products", error);
        return;
      }

      if (!active) return;

      const map: BundleProductMap = {};
      (data || []).forEach((p: any) => {
        const code = (p.product_code || "").trim().toUpperCase();
        if (!code) return;
        map[code] = {
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
          btu_rating: p.btu_rating || null,
          supplier_discount_percent: null,
          markup_percent: p.default_markup_percent ?? 35,
          default_markup_percent: p.default_markup_percent ?? 35,
          cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
        };
      });

      console.log("[AutoBundle] bundle products loaded", {
        requestedCodes: allCodes.length,
        loadedProducts: Object.keys(map).length,
      });

      setBundleProducts(map);
    };

    loadBundleProducts();

    return () => {
      active = false;
    };
  }, [allCodes]);

  return bundleProducts;
}
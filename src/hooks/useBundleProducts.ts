import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CAPACITY_TIER_CONFIGS } from "@/lib/bundleTierConfig";

interface SupplierProductRow {
  id: string;
  product_code?: string | null;
  short_name?: string | null;
  brand?: string | null;
  product_category?: string | null;
  category?: string | null;
  cost_price?: number | null;
  cost_excl_vat?: number | null;
  cost_incl_vat?: number | null;
  selling_price?: number | null;
  description?: string | null;
  is_pinned?: boolean | null;
  pin_order?: number | null;
  price_per_metre?: number | null;
  sold_in_length?: boolean | null;
  unit_length?: number | null;
  pipe_size?: string | null;
  is_material_favorite?: boolean | null;
  pack_qty?: number | null;
  default_markup_percent?: number | null;
  btu_rating?: number | null;
  suppliers?: { name?: string | null; supplier_type?: string | null } | null;
}

export interface BundleProduct extends SupplierProductRow {
  supplier_name: string;
  supplier_type: string;
  supplier_discount_percent: number | null;
  markup_percent: number;
}

type BundleProductMap = Record<string, BundleProduct>;

const SUPPLIER_PRODUCT_SELECT = "id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, pack_qty, default_markup_percent, btu_rating, suppliers(name, supplier_type)";

const toBundleProduct = (p: SupplierProductRow): BundleProduct => ({
  ...p,
  product_category: p.product_category || p.category || "",
  supplier_name: p.suppliers?.name || "",
  supplier_type: p.suppliers?.supplier_type || "both",
  price_per_metre: p.price_per_metre ?? null,
  sold_in_length: p.sold_in_length ?? false,
  unit_length: p.unit_length ?? null,
  pipe_size: p.pipe_size ?? null,
  is_material_favorite: p.is_material_favorite ?? false,
  pack_qty: p.pack_qty ?? null,
  btu_rating: p.btu_rating ?? null,
  supplier_discount_percent: null,
  markup_percent: p.default_markup_percent ?? 35,
  default_markup_percent: p.default_markup_percent ?? 35,
  cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
});

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

      const { data: byCodeData, error: byCodeError } = await (supabase.from("supplier_products") as any)
        .select(SUPPLIER_PRODUCT_SELECT)
        .eq("is_active", true)
        .or("archived.is.null,archived.eq.false")
        .in("product_code", allCodes)
        .limit(2000);

      if (byCodeError) {
        console.error("[AutoBundle] failed to load bundle products by code", byCodeError);
      }

      let byTierFlagData: any[] = [];
      const { data: tierFlagRows, error: tierFlagError } = await (supabase.from("supplier_products") as any)
        .select(SUPPLIER_PRODUCT_SELECT)
        .eq("is_active", true)
        .eq("tier_bundle", true)
        .or("archived.is.null,archived.eq.false")
        .limit(2000);

      if (tierFlagError) {
        console.warn("[AutoBundle] tier_bundle lookup unavailable; falling back to name pattern only", tierFlagError.message || tierFlagError);
      } else {
        byTierFlagData = tierFlagRows || [];
      }

      const namePatternFilter = [
        "short_name.ilike.%09K INV PIPING KIT%",
        "short_name.ilike.%12K INV PIPING KIT%",
        "short_name.ilike.%18K INV PIPING KIT%",
        "short_name.ilike.%PIPING KIT%",
        "description.ilike.%PIPING KIT%",
      ].join(",");

      const { data: byNameData, error: byNameError } = await (supabase.from("supplier_products") as any)
        .select(SUPPLIER_PRODUCT_SELECT)
        .eq("is_active", true)
        .or(`archived.is.null,archived.eq.false`)
        .or(namePatternFilter)
        .limit(2000);

      if (byNameError) {
        console.warn("[AutoBundle] failed to load bundle products by name pattern", byNameError);
      }

      if (!active) return;

      const merged = new Map<string, any>();
      const pushRows = (rows?: any[]) => {
        (rows || []).forEach((row) => {
          if (!row?.id) return;
          merged.set(row.id, row);
        });
      };

      pushRows(byCodeData || []);
      pushRows(byTierFlagData || []);
      pushRows(byNameData || []);

      const map: BundleProductMap = {};
      Array.from(merged.values()).forEach((p) => {
        const code = (p.product_code || "").trim().toUpperCase();
        if (!code) return;
        map[code] = toBundleProduct(p);
      });

      console.log("[AutoBundle] bundle products loaded", {
        requestedCodes: allCodes.length,
        matchedByCode: (byCodeData || []).length,
        matchedByTierFlag: (byTierFlagData || []).length,
        matchedByNamePattern: (byNameData || []).length,
        loadedProducts: Object.keys(map).length,
        loadedCodes: Object.keys(map),
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

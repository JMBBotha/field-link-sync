import { useState, useEffect } from "react";
import { liveProducts } from "@/lib/liveProducts";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { calcSellingPrice, resolveProductMarkupPercent } from "@/lib/pricing";

export interface ProductOption {
  id: string;
  name: string;
  description: string | null;
  /** Selling price excl VAT */
  rate: number;
  /** Net cost excl VAT (0 for service templates) */
  cost?: number;
  category: string;
  isFavorite: boolean;
  source: "template" | "product";
  productCode?: string;
}

const isAcCategory = (cat: string) => {
  const l = cat.toLowerCase();
  return l.includes("ac") || l.includes("air con");
};

const sortProductOptions = (options: ProductOption[]) =>
  [...options].sort((a, b) => {
    const aStarAc = a.isFavorite && isAcCategory(a.category) ? 0 : 1;
    const bStarAc = b.isFavorite && isAcCategory(b.category) ? 0 : 1;
    if (aStarAc !== bStarAc) return aStarAc - bStarAc;
    const aFav = a.isFavorite ? 0 : 1;
    const bFav = b.isFavorite ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.name.localeCompare(b.name);
  });

export const filterProductOptions = (options: ProductOption[], query: string) => {
  if (!query) return options.slice(0, 8);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options.slice(0, 8);
  return options.filter((o) => {
    const blob = [o.name, o.description || "", o.productCode || "", o.category || ""].join(" ").toLowerCase();
    return words.every((w) => blob.includes(w));
  });
};

export { isAcCategory };

export function useProductOptions() {
  const [allOptions, setAllOptions] = useState<ProductOption[]>([]);
  const { isFieldAgent, isAdmin, isDispatcher, loading: roleLoading } = useRole();
  const techOnly = isFieldAgent && !isAdmin && !isDispatcher;

  useEffect(() => {
    if (roleLoading) return;
    let cancelled = false;
    Promise.all([
      supabase
        .from("catalog_services" as any)
        .select("id, name, description, sort_order, origin")
        .eq("is_active", true)
        .order("sort_order", { nullsFirst: false }),
      techOnly
        ? (supabase.rpc as any)("get_tech_catalogue") // techs: no prices from the server
        : liveProducts()
        .select("id, product_code, short_name, description, cost_price, default_markup_percent, markup_percent, category, is_pinned")
        .eq("is_active", true)
        .order("is_pinned", { ascending: false })
        .order("description"),
    ])
      .then(([svcRes, prodRes]) => {
        if (cancelled) return;
        if (svcRes.error) {
          console.error("[useProductOptions] catalog_services error:", svcRes.error);
          return;
        }
        if (prodRes.error) {
          console.error("[useProductOptions] supplier_products error:", prodRes.error);
          return;
        }
        const svcData = ((svcRes.data || []) as any[]).filter((s) => s.origin === "core");
        const prodData = prodRes.data || [];
        const merged: ProductOption[] = [
          ...svcData.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            rate: 0,
            category: "Services",
            isFavorite: false,
            source: "template" as const,
          })),
          ...(techOnly ? (prodData as any[]).map((row) => ({
            id: row.id,
            name: row.name,
            description: row.name,
            rate: 0,
            category: row.category,
            isFavorite: false,
            source: "product" as const,
            productCode: row.model || "",
          })) : (prodData as any[]).map((p) => ({
            id: p.id,
            name: p.short_name || p.description,
            description: p.description,
            // rate is the SELL price excl VAT (cost is already net of trade discount)
            rate: calcSellingPrice(
              Number(p.cost_price || 0),
              resolveProductMarkupPercent(p as any),
            ).sellingExclVat,
            cost: Number(p.cost_price || 0),
            category: p.category,
            isFavorite: p.is_pinned ?? false,
            source: "product" as const,
            productCode: p.product_code || "",
          }))),
        ];
        setAllOptions(sortProductOptions(merged));
      })
      .catch((err) => {
        console.error("[useProductOptions] Failed to load options:", err);
      });

    return () => { cancelled = true; };
  }, [techOnly, roleLoading]);

  return allOptions;
}

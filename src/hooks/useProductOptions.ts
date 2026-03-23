import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProductOption {
  id: string;
  name: string;
  description: string | null;
  rate: number;
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
  const q = query.toLowerCase();
  return options.filter(
    (o) =>
      o.name.toLowerCase().includes(q) ||
      (o.description && o.description.toLowerCase().includes(q)) ||
      (o.productCode && o.productCode.toLowerCase().includes(q))
  );
};

export { isAcCategory };

export function useProductOptions() {
  const [allOptions, setAllOptions] = useState<ProductOption[]>([]);

  useEffect(() => {
    Promise.all([
      supabase
        .from("service_templates")
        .select("id, name, description, default_rate, category")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("supplier_products")
        .select("id, product_code, short_name, description, cost_price, category, is_pinned")
        .eq("is_active", true)
        .order("is_pinned", { ascending: false })
        .order("description"),
    ]).then(([svcRes, prodRes]) => {
      const svcData = svcRes.data || [];
      const prodData = prodRes.data || [];
      const merged: ProductOption[] = [
        ...svcData.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          rate: Number(s.default_rate),
          category: s.category,
          isFavorite: false,
          source: "template" as const,
        })),
        ...prodData.map((p: any) => ({
          id: p.id,
          name: p.short_name || p.description,
          description: p.description,
          rate: Number(p.cost_price || 0),
          category: p.category,
          isFavorite: p.is_pinned ?? false,
          source: "product" as const,
        })),
      ];
      setAllOptions(sortProductOptions(merged));
    });
  }, []);

  return allOptions;
}

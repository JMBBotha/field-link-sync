import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type BrandCount = { brand: string; total: number; categories: { name: string; count: number }[] };

/** Group live products by brand, then by category. Brands with a live price book but no products show 0. */
export function groupBrandCounts(
  products: { brand: string | null; product_category: string | null; category: string | null }[],
  liveBookBrands: (string | null)[] = [],
): BrandCount[] {
  const map = new Map<string, { brand: string; total: number; cats: Map<string, number> }>();
  const get = (raw: string | null) => {
    const brand = (raw || "").trim() || "No brand";
    const key = brand.toLowerCase();
    if (!map.has(key)) map.set(key, { brand, total: 0, cats: new Map() });
    return map.get(key)!;
  };
  for (const p of products) {
    const b = get(p.brand);
    b.total += 1;
    const cat = (p.product_category || p.category || "").trim() || "Other";
    b.cats.set(cat, (b.cats.get(cat) || 0) + 1);
  }
  for (const lb of liveBookBrands) if (lb) get(lb);
  return Array.from(map.values())
    .map((b) => ({ brand: b.brand, total: b.total, categories: Array.from(b.cats, ([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count) }))
    .sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand));
}

export default function SupplierBrandCounts({ supplierId, enabled = true }: { supplierId: string; enabled?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["supplier-brand-counts", supplierId],
    enabled: !!supplierId && enabled,
    queryFn: async () => {
      const [{ data: prods, error }, { data: books }] = await Promise.all([
        (supabase.from("supplier_products") as any)
          .select("brand, product_category, category")
          .eq("supplier_id", supplierId)
          .or("archived.is.null,archived.eq.false")
          .limit(5000),
        (supabase.from("pdf_uploads") as any).select("brand").eq("supplier_id", supplierId).eq("is_active", true),
      ]);
      if (error) throw error;
      return groupBrandCounts(prods || [], (books || []).map((b: any) => b.brand));
    },
  });
  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div data-testid="supplier-brand-counts">
      <div className="flex justify-between">
        <span className="text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" />Products</span>
        <span>{isLoading ? "…" : total}</span>
      </div>
      {rows.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {rows.map((r) => {
            const isOpen = open === r.brand;
            return (
              <div key={r.brand} className="rounded-md border border-border bg-muted/40">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.brand)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                  aria-expanded={isOpen}
                  data-testid="brand-count-row"
                >
                  <span className="flex items-center gap-1 text-sm font-medium truncate">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    {r.brand}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">{r.total}</span>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-2 pl-7 space-y-0.5">
                    {r.categories.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No products yet. Open Price lists and tap Import products.</p>
                    ) : r.categories.map((c) => (
                      <div key={c.name} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{c.name}</span>
                        <span className="tabular-nums">{c.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

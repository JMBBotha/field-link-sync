/**
 * QuoteQuickEditor — slim search bar that adds lines into the OPEN quote.
 *
 * It is deliberately NOT a second UI: it renders as one thin row of inputs that
 * sits inside the estimate document surface. All writes go through QuoteContext
 * into quote_items / quote_areas for the already-open quoteId. The Visual PDF
 * catalog stays in the full builder.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Star, Wrench, Package, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useProductFavorites } from "@/hooks/useProductFavorites";
import { getEffectiveUnitPrices, type PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { allTermsMatchBlob } from "@/components/catalog/searchSynonyms";
import type { QuoteItemInsert } from "@/types/quote";

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
  default_price: number | null;
  unit: string | null;
}

function baseItem(): Omit<QuoteItemInsert, "quote_id" | "item_name" | "unit_price" | "sort_order"> {
  return {
    area_id: null,
    parent_item_id: null,
    product_id: null,
    item_number: null,
    description: null,
    quantity: 1,
    length: null,
    total_price: null,
    is_bundle: false,
    item_type: "product",
    metadata: {},
    notes: null,
    source: "manual",
    supplier: null,
  };
}

export default function QuoteQuickEditor({
  onChanged,
  targetAreaId = null,
  dropUp = false,
}: {
  onChanged?: () => void;
  /** Add new lines into this area (defaults to the first / default area). */
  targetAreaId?: string | null;
  /** Open the results list upward (used when the bar sits at the bottom of the document). */
  dropUp?: boolean;
}) {
  const { areas, items, addItem, addArea, ensureDefaultArea } = useQuoteContext();
  const dropdownPos = dropUp ? "bottom-full mb-1" : "mt-1";
  const { favorites } = useProductFavorites();
  const [productTerm, setProductTerm] = useState("");
  const [serviceTerm, setServiceTerm] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["quote-builder-products"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select(
          "id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, ai_sales_description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, pack_qty, default_markup_percent, btu_rating, suppliers(name, supplier_type)",
        )
        .or("archived.is.null,archived.eq.false")
        .limit(2000);
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
        supplier_type: p.suppliers?.supplier_type || "both",
        supplier_discount_percent: null,
        markup_percent: p.default_markup_percent ?? 35,
        default_markup_percent: p.default_markup_percent ?? 35,
        cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
      })) as PaletteProduct[];
    },
  });

  const { data: services = [] } = useQuery({
    queryKey: ["hvac-services-active"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hvac_services")
        .select("id, name, category, default_price, unit")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return (data || []) as ServiceRow[];
    },
  });

  const onQuoteProductIds = useMemo(
    () => new Set(items.map((i) => i.product_id).filter(Boolean) as string[]),
    [items],
  );
  const onQuoteNames = useMemo(
    () => new Set(items.map((i) => (i.item_name || "").toLowerCase())),
    [items],
  );

  const productResults = useMemo(() => {
    const term = productTerm.trim();
    if (term.length < 2) return [];
    const terms = term.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = products.filter((p) =>
      allTermsMatchBlob(
        terms,
        `${p.product_code || ""} ${p.short_name || ""} ${p.brand || ""} ${p.product_category || ""} ${p.description || ""}`.toLowerCase(),
      ),
    );
    const rank = (p: PaletteProduct) =>
      favorites.has(p.id) || p.is_pinned ? 0 : onQuoteProductIds.has(p.id) ? 1 : 2;
    return matched.sort((a, b) => rank(a) - rank(b)).slice(0, 25);
  }, [productTerm, products, favorites, onQuoteProductIds]);

  const serviceResults = useMemo(() => {
    const term = serviceTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    const matched = services.filter((s) =>
      `${s.name} ${s.category || ""}`.toLowerCase().includes(term),
    );
    const rank = (s: ServiceRow) => (onQuoteNames.has(s.name.toLowerCase()) ? 0 : 1);
    return matched.sort((a, b) => rank(a) - rank(b)).slice(0, 25);
  }, [serviceTerm, services, onQuoteNames]);

  const nextSortOrder = () => (items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0);

  const resolveArea = async () => {
    if (targetAreaId) return targetAreaId;
    const area = areas[0] || (await ensureDefaultArea());
    return area?.id ?? null;
  };

  const addProduct = async (p: PaletteProduct) => {
    setAdding(p.id);
    const areaId = await resolveArea();
    const { unitCost, unitSell } = getEffectiveUnitPrices(p);
    const markupPct = p.default_markup_percent ?? p.markup_percent ?? 35;
    await addItem({
      ...baseItem(),
      area_id: areaId,
      product_id: p.id,
      item_name: p.short_name || p.product_code || "Product",
      item_number: p.product_code || null,
      // Prefer the AI sales blurb (AC units) over the raw catalog description.
      description: (p as any).ai_sales_description || p.description || null,
      supplier: p.supplier_name || null,
      unit_price: Number(unitSell.toFixed(2)),
      // Cost snapshot so staff margin stays correct after a price override.
      metadata: { unit_cost: Number(unitCost.toFixed(2)), markup_percent: markupPct },
      sort_order: nextSortOrder(),
      source: "catalog",
    });
    setAdding(null);
    setProductTerm("");
    onChanged?.();
  };

  const addService = async (s: ServiceRow) => {
    setAdding(s.id);
    const areaId = await resolveArea();
    await addItem({
      ...baseItem(),
      area_id: areaId,
      item_name: s.name,
      description: s.category || null,
      item_type: "service",
      unit_price: Number(s.default_price || 0),
      metadata: { unit_cost: 0, markup_percent: 0 },
      sort_order: nextSortOrder(),
      source: "service",
    });
    setAdding(null);
    setServiceTerm("");
    onChanged?.();
  };

  return (
    <div className="print:hidden">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="relative">
          <Package className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={productTerm}
            onChange={(e) => setProductTerm(e.target.value)}
            placeholder="Add item from catalog…"
            className="h-9 border-slate-200 bg-white pl-9 text-slate-800 placeholder:text-slate-400"
          />
          {loadingProducts && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
          {productResults.length > 0 && (
            <ScrollArea className="absolute z-30 mt-1 max-h-64 w-full rounded-md border border-slate-200 bg-white shadow-lg">
              <div className="divide-y divide-slate-100">
                {productResults.map((p) => {
                  const { unitSell } = getEffectiveUnitPrices(p);
                  const fav = favorites.has(p.id) || p.is_pinned;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      disabled={adding === p.id}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      {fav ? (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                        {p.short_name || p.product_code}
                        <span className="ml-1 text-xs text-slate-500">{p.brand}</span>
                      </span>
                      {onQuoteProductIds.has(p.id) && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">on quote</Badge>
                      )}
                      <span className="shrink-0 text-xs font-medium text-slate-700">{money(unitSell)}</span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="relative">
          <Wrench className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={serviceTerm}
            onChange={(e) => setServiceTerm(e.target.value)}
            placeholder="Add service…"
            className="h-9 border-slate-200 bg-white pl-9 text-slate-800 placeholder:text-slate-400"
          />
          {serviceResults.length > 0 && (
            <ScrollArea className="absolute z-30 mt-1 max-h-64 w-full rounded-md border border-slate-200 bg-white shadow-lg">
              <div className="divide-y divide-slate-100">
                {serviceResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addService(s)}
                    disabled={adding === s.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                      {s.name}
                      {s.category && <span className="ml-1 text-xs text-slate-500">{s.category}</span>}
                    </span>
                    {onQuoteNames.has(s.name.toLowerCase()) && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">on quote</Badge>
                    )}
                    <span className="shrink-0 text-xs font-medium text-slate-700">
                      {money(Number(s.default_price || 0))}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}

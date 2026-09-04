/**
 * QuoteQuickEditor — inline "daily editor" for the estimate page.
 *
 * Reuses the existing quote spine: QuoteContext writes straight into
 * quote_items / quote_areas for the ALREADY OPEN quoteId. It never creates a
 * second quote. Ranking of search results: favorites → already on this quote →
 * everything else. The Visual PDF catalog stays in the full builder.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Minus, Trash2, Star, Wrench, Package, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

export default function QuoteQuickEditor({ onChanged }: { onChanged?: () => void }) {
  const { quoteId, areas, items, addItem, updateItem, deleteItem, updateArea, ensureDefaultArea } =
    useQuoteContext();
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
          "id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, pack_qty, default_markup_percent, btu_rating, suppliers(name, supplier_type)",
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

  const addProduct = async (p: PaletteProduct) => {
    setAdding(p.id);
    const area = areas[0] || (await ensureDefaultArea());
    const { unitSell } = getEffectiveUnitPrices(p);
    await addItem({
      ...baseItem(),
      area_id: area?.id ?? null,
      product_id: p.id,
      item_name: p.short_name || p.product_code || "Product",
      item_number: p.product_code || null,
      description: p.description || null,
      supplier: p.supplier_name || null,
      unit_price: Number(unitSell.toFixed(2)),
      sort_order: nextSortOrder(),
      source: "catalog",
    });
    setAdding(null);
    setProductTerm("");
    onChanged?.();
  };

  const addService = async (s: ServiceRow) => {
    setAdding(s.id);
    const area = areas[0] || (await ensureDefaultArea());
    await addItem({
      ...baseItem(),
      area_id: area?.id ?? null,
      item_name: s.name,
      description: s.category || null,
      item_type: "service",
      unit_price: Number(s.default_price || 0),
      sort_order: nextSortOrder(),
      source: "service",
    });
    setAdding(null);
    setServiceTerm("");
    onChanged?.();
  };

  const setQty = async (id: string, qty: number) => {
    if (qty <= 0) {
      await deleteItem(id);
    } else {
      await updateItem(id, { quantity: qty });
    }
    onChanged?.();
  };

  const topLevel = items.filter((i) => !i.parent_item_id);

  return (
    <Card className="space-y-4 p-4 print:hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Build this quote</h2>
        <span className="text-xs text-muted-foreground">Autosaves to {quoteId.slice(0, 8)}…</span>
      </div>

      {/* Search bars */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <div className="relative">
            <Package className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={productTerm}
              onChange={(e) => setProductTerm(e.target.value)}
              placeholder="Search items (catalog)…"
              className="pl-9"
            />
            {loadingProducts && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin" />}
          </div>
          {productResults.length > 0 && (
            <ScrollArea className="max-h-64 rounded-md border border-border">
              <div className="divide-y divide-border">
                {productResults.map((p) => {
                  const { unitSell } = getEffectiveUnitPrices(p);
                  const fav = favorites.has(p.id) || p.is_pinned;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      disabled={adding === p.id}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
                    >
                      {fav ? (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {p.short_name || p.product_code}
                        <span className="ml-1 text-xs text-muted-foreground">{p.brand}</span>
                      </span>
                      {onQuoteProductIds.has(p.id) && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          on quote
                        </Badge>
                      )}
                      <span className="shrink-0 text-xs font-medium">{money(unitSell)}</span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Wrench className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={serviceTerm}
              onChange={(e) => setServiceTerm(e.target.value)}
              placeholder="Search services…"
              className="pl-9"
            />
          </div>
          {serviceResults.length > 0 && (
            <ScrollArea className="max-h-64 rounded-md border border-border">
              <div className="divide-y divide-border">
                {serviceResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addService(s)}
                    disabled={adding === s.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {s.name}
                      {s.category && <span className="ml-1 text-xs text-muted-foreground">{s.category}</span>}
                    </span>
                    {onQuoteNames.has(s.name.toLowerCase()) && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        on quote
                      </Badge>
                    )}
                    <span className="shrink-0 text-xs font-medium">{money(Number(s.default_price || 0))}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Area descriptions */}
      {areas.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Areas (prints on the quote)</p>
          {areas.map((a) => (
            <Input
              key={a.id}
              defaultValue={a.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== a.name) {
                  void updateArea(a.id, { name: v });
                  onChanged?.();
                }
              }}
              className="h-9"
            />
          ))}
        </div>
      )}

      {/* Line items with qty steppers */}
      <div className="space-y-1">
        {topLevel.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No lines yet — search items or services above.
          </p>
        )}
        {topLevel.map((i) => (
          <div key={i.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{i.item_name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{money(i.unit_price)}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setQty(i.id, Number(i.quantity) - 1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center text-sm tabular-nums">{i.quantity}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setQty(i.id, Number(i.quantity) + 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <span className="w-24 shrink-0 text-right text-sm font-medium">
              {money(Number(i.quantity) * Number(i.unit_price))}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => {
                void deleteItem(i.id);
                onChanged?.();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

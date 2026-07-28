/**
 * Unified Quote Builder Page — wraps Normal / Visual / Area builders
 * in a shared header with tabs. Each tab renders the real builder component.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { PdfSelectedProduct } from "@/types/pdfSelection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users, X, Loader2 } from "lucide-react";
import { allTermsMatchBlob } from "@/components/catalog/searchSynonyms";
import { useProductUsageStats } from "@/hooks/useProductUsageStats";
import ProductPalette from "@/components/catalog/quote-builder/ProductPalette";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { QuoteProvider, useQuoteContext } from "@/contexts/QuoteContext";
import { useUnifiedClients } from "@/hooks/useUnifiedClients";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

// Real builder components
import QuoteBuilderTab from "@/components/catalog/QuoteBuilderTab";
import type { PaletteProduct, Basket } from "@/components/catalog/QuoteBuilderTab";
import VisualCatalogPanel from "@/components/catalog/quote-builder/VisualCatalogPanel";
import type { WizardTriggerItem } from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import QuoteBuilderPopup from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import QuoteSummaryPanel from "@/components/catalog/quote-builder/QuoteSummaryPanel";
import AreaQuoteBuilderInline from "@/components/catalog/quote-builder/AreaQuoteBuilderInline";
import AreaQuoteSummary from "@/components/catalog/quote-builder/AreaQuoteSummary";
import FloatingSelectedItems from "@/components/catalog/quote-builder/FloatingSelectedItems";
import type { QuoteArea } from "@/components/catalog/quote-builder/quoteWizardTypes";
import type { PaletteBundle } from "@/components/catalog/quote-builder/ProductPalette";

export type QuoteBuilderMode = "admin" | "agent";

/* ─── Shared Header with client selector ─── */
function QuoteSharedHeader({ onBack }: {onBack: () => void;}) {
  const { meta, updateQuote, areas, items } = useQuoteContext();
  const { data: clients = [] } = useUnifiedClients();
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedClient = useMemo(() => {
    if (!meta?.customer_id) return null;
    return clients.find((c) => c.id === meta.customer_id || c.customer_id === meta.customer_id) || null;
  }, [clients, meta?.customer_id]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 8);
    const q = clientSearch.toLowerCase();
    return clients.
    filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.phone.includes(q) ||
    c.email && c.email.toLowerCase().includes(q)
    ).
    slice(0, 8);
  }, [clients, clientSearch]);

  const topLevel = items.filter((i) => !i.parent_item_id);
  const totalItems = topLevel.length;
  const totalCost = topLevel.reduce((s, i) => s + (i.total_price ?? i.unit_price * i.quantity), 0);
  // Zone count = declared areas + a synthetic "General" zone when items have no area_id.
  // Matches the body's grouping so the header badge and body always agree.
  const zoneIds = new Set<string>();
  let hasUnassigned = false;
  for (const it of topLevel) {
    if (it.area_id) zoneIds.add(it.area_id);
    else hasUnassigned = true;
  }
  for (const a of areas) zoneIds.add(a.id);
  const zoneCount = zoneIds.size + (hasUnassigned ? 1 : 0);

  return (
    <header className="shrink-0 h-14 flex items-center justify-between px-4 shadow-sm" style={{ backgroundColor: "#0077B6" }}>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-9 w-9 rounded-xl text-white hover:bg-white/10">

          <ArrowLeft className="h-4 w-4" />
        </Button>
        <img src={logo} alt="Logo" style={{ height: "50px" }} />
        <div className="hidden sm:block h-6 w-px bg-white/20" />
        <h1 className="hidden sm:block text-lg font-semibold tracking-tight text-white">
          Quote Builder
        </h1>
      </div>

      {/* Client selector in header */}
      <div className="flex items-center gap-3">
        <div className="relative">
          {selectedClient ?
          <div className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium truncate max-w-[150px]">{selectedClient.name}</span>
              <button
              onClick={() => {
                updateQuote({ customer_id: null, customer_name: null });
                setClientSearch("");
              }}
              className="hover:text-white/60">

                <X className="h-3 w-3" />
              </button>
            </div> :

          <div className="relative">
              <Input
              ref={inputRef}
              placeholder="Select client..."
              value={clientSearch}
              onChange={(e) => {
                setClientSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              className="h-8 w-48 text-xs rounded-lg bg-white/10 border-white/20 text-white placeholder:text-white/50" />

              {showDropdown && filteredClients.length > 0 &&
            <div className="absolute z-50 top-full right-0 mt-1 w-64 rounded-lg border bg-popover shadow-lg max-h-48 overflow-y-auto">
                  {filteredClients.map((c) =>
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  const cid = c.customer_id || c.id;
                  const finalCid = cid.startsWith("lead-") ? null : cid;
                  await updateQuote({
                    customer_id: finalCid,
                    customer_name: c.name
                  });
                  setClientSearch("");
                  setShowDropdown(false);
                }}>

                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {c.phone}
                        {c.email ? ` · ${c.email}` : ""}
                      </p>
                    </button>
              )}
                </div>
            }
            </div>
          }
        </div>

        <div className="hidden md:flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5">
          <span className="text-xs text-white/70">
            {totalItems} items · {zoneCount} zones
          </span>
          <span className="text-sm font-bold text-white ml-1">
            R{totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </span>
        </div>

        {meta?.quote_number ?
        <span className="hidden lg:block text-[10px] text-white/50 font-mono">{meta.quote_number}</span> :

        <span className="hidden lg:block text-[10px] text-amber-300 font-mono">Pending – assign a client</span>
        }
      </div>
    </header>);

}

/* ─── Inner content (needs context) ─── */
function UnifiedQuoteBuilderInner({ mode = "admin" }: { mode?: QuoteBuilderMode }) {
  const navigate = useNavigate();
  const { items: ctxItems, areas: ctxAreas, loading: ctxLoading } = useQuoteContext();
  const [activeTab, setActiveTab] = useState("normal");
  const [areaWizardOpen, setAreaWizardOpen] = useState(false);
  const pdfSearchRef = useRef<((term: string) => void) | null>(null);

  // Shared baskets state for cross-tab data
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [wizardAreas, setWizardAreas] = useState<QuoteArea[]>([]);

  // Area tab palette state
  const [areaSearch, setAreaSearch] = useState("");
  const [areaDebouncedSearch, setAreaDebouncedSearch] = useState("");
  const [areaCategoryFilter, setAreaCategoryFilter] = useState("all");
  const { usageMap: areaUsageMap } = useProductUsageStats();
  useEffect(() => {
    const t = setTimeout(() => setAreaDebouncedSearch(areaSearch), 300);
    return () => clearTimeout(t);
  }, [areaSearch]);

  // Fetch products for Visual + Area builders (must be declared before useMemo that references it)
  const { data: products = [] } = useQuery({
    queryKey: ["quote-builder-products"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any).
      select("id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, suggested_consumables, pack_qty, default_markup_percent, suppliers(name, supplier_type)").
      or("archived.is.null,archived.eq.false").
      order("is_pinned", { ascending: false }).
      order("pin_order", { ascending: true, nullsFirst: false }).
      limit(2000);
      if (error) throw error;
      return (data || []).map((p: any) => ({
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
        cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
        cost_excl_vat: p.cost_excl_vat ?? p.cost_price ?? 0,
        cost_incl_vat: 0,
        supplier_discount_percent: null,
        markup_percent: p.default_markup_percent ?? 35,
        default_markup_percent: p.default_markup_percent ?? 35,
      })) as PaletteProduct[];
    },
    staleTime: 60000
  });

  const areaFilteredProducts = useMemo(() => {
    let result = products;
    if (!areaDebouncedSearch.trim() && areaCategoryFilter !== "all" && areaCategoryFilter !== "favorites") {
      result = result.filter((p) =>
        p.product_category === areaCategoryFilter ||
        (p.category || "").toLowerCase().includes(areaCategoryFilter.toLowerCase())
      );
    }
    if (areaDebouncedSearch.trim()) {
      const terms = areaDebouncedSearch.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand, p.description, p.category, p.product_category, p.supplier_name].filter(Boolean).join(" ").toLowerCase();
        return allTermsMatchBlob(terms, blob);
      });
    }
    return result;
  }, [products, areaCategoryFilter, areaDebouncedSearch]);

  const areaFavorites = useMemo(() => new Set(products.filter((p) => p.is_pinned).map((p) => p.id)), [products]);

  /**
   * Hydrate baskets from the unified quote (context items+areas) so the
   * "Build" tab body reflects the same data the header summary reads. Without
   * this, opening an existing quote left the body at its default empty basket
   * even though the header showed the real totals — the split-brain bug.
   *
   * We build stub PaletteProducts using the stored unit_price so per-item
   * totals match `quote_items.total_price` exactly (no markup recompute).
   */
  const initialBaskets = useMemo<Basket[] | null>(() => {
    if (ctxLoading) return null;
    if (ctxItems.length === 0 && ctxAreas.length === 0) {
      return [{ id: "basket-1", name: "Zone 1", items: [] }];
    }
    const productById = new Map(products.map((p) => [p.id, p]));
    const stub = (it: typeof ctxItems[number]): PaletteProduct => ({
      id: it.product_id || it.id,
      product_code: it.item_number || "",
      short_name: it.item_name,
      brand: "",
      product_category: it.item_type || "",
      category: it.item_type || "",
      description: it.description || "",
      cost_price: it.unit_price,
      cost_excl_vat: it.unit_price,
      cost_incl_vat: 0,
      selling_price: it.unit_price,
      supplier_name: it.supplier || "",
      supplier_type: "both",
      supplier_discount_percent: null,
      markup_percent: 0,
      default_markup_percent: 0,
      is_pinned: false,
      pin_order: null,
      price_per_metre: it.length ? it.unit_price : null,
      sold_in_length: !!it.length,
      unit_length: it.length || null,
      pipe_size: null,
      is_material_favorite: false,
      pack_qty: null,
    } as unknown as PaletteProduct);
    const toItem = (it: typeof ctxItems[number]) => {
      const product = (it.product_id && productById.get(it.product_id)) || stub(it);
      return {
        instanceId: it.id,
        product: stub(it), // always use stub so total = stored unit_price * qty
        quantity: it.quantity,
        ...(it.length ? { length: it.length } : {}),
        ...(it.is_bundle ? { isBundle: true } : {}),
      };
    };
    const groups = new Map<string, typeof ctxItems>();
    for (const a of ctxAreas) groups.set(a.id, [] as any);
    const unassigned: typeof ctxItems = [] as any;
    for (const it of ctxItems) {
      if (it.parent_item_id) continue;
      if (it.area_id && groups.has(it.area_id)) (groups.get(it.area_id) as any).push(it);
      else (unassigned as any).push(it);
    }
    const result: Basket[] = ctxAreas.map((a) => ({
      id: a.id,
      name: a.name,
      items: (groups.get(a.id) || []).map(toItem),
    }));
    if (unassigned.length) result.push({ id: "unassigned", name: "General", items: unassigned.map(toItem) });
    if (result.length === 0) result.push({ id: "basket-1", name: "Zone 1", items: [] });
    return result;
  }, [ctxLoading, ctxItems, ctxAreas, products]);

  /**
   * Seed the Area/Wizard builder with real DB items so the Areas step shows
   * the actual line items rather than the "Additional Items/Services"
   * placeholder. We classify each item into acUnits / materials / consumables
   * based on category and length.
   */
  const initialWizardAreas = useMemo<WizardAreaType[] | null>(() => {
    if (ctxLoading) return null;
    if (ctxItems.length === 0 && ctxAreas.length === 0) return null;
    const productById = new Map(products.map((p) => [p.id, p]));
    const stubProduct = (it: typeof ctxItems[number]): PaletteProduct => ({
      id: it.product_id || it.id,
      product_code: it.item_number || "",
      short_name: it.item_name,
      brand: "",
      product_category: it.item_type || "",
      category: it.item_type || "",
      description: it.description || "",
      cost_price: it.unit_price,
      cost_excl_vat: it.unit_price,
      cost_incl_vat: 0,
      selling_price: it.unit_price,
      supplier_name: it.supplier || "",
      supplier_type: "both",
      supplier_discount_percent: null,
      markup_percent: 0,
      default_markup_percent: 0,
      is_pinned: false,
      pin_order: null,
      price_per_metre: it.length ? it.unit_price : null,
      sold_in_length: !!it.length,
      unit_length: it.length || null,
      pipe_size: null,
      is_material_favorite: false,
      pack_qty: null,
    } as unknown as PaletteProduct);
    const topLevel = ctxItems.filter((i) => !i.parent_item_id);
    // Group items by area_id (null → default "General" bucket)
    const buckets = new Map<string | null, typeof ctxItems>();
    for (const a of ctxAreas) buckets.set(a.id, [] as any);
    for (const it of topLevel) {
      const key = it.area_id && buckets.has(it.area_id) ? it.area_id : null;
      if (!buckets.has(key)) buckets.set(key, [] as any);
      (buckets.get(key) as any).push(it);
    }
    const areaNameFor = (id: string | null): string => {
      if (!id) return ctxAreas.length === 0 ? "Additional Items/Services" : "General";
      return ctxAreas.find((a) => a.id === id)?.name || "General";
    };
    const result: WizardAreaType[] = [];
    for (const [key, list] of buckets) {
      const base = createEmptyArea(areaNameFor(key));
      for (const it of list) {
        const product = (it.product_id && productById.get(it.product_id)) || stubProduct(it);
        const cat = (product.product_category || product.category || "").toLowerCase();
        const isAC = cat.includes("air") || cat.includes(" ac") || cat === "ac" || cat.includes("hvac");
        if (isAC) {
          base.acUnits.push({ id: it.id, product: stubProduct(it), btu: detectBTU(product), quantity: it.quantity });
        } else if (it.length && it.length > 0) {
          const perM = it.unit_price;
          base.materials.push({
            id: it.id,
            product: stubProduct(it),
            defaultLength: it.length,
            adjustedLength: it.length,
            costPerMeter: perM,
            totalCost: perM * it.length,
            pricingMode: "length",
            unitQuantity: 1,
          });
        } else {
          base.consumables.push({ id: it.id, product: stubProduct(it), quantity: it.quantity });
        }
      }
      base.subtotal = computeAreaSubtotal(base);
      // Only include non-empty areas, plus any explicitly declared ctxAreas
      if (base.acUnits.length || base.materials.length || base.consumables.length || key) {
        result.push(base);
      }
    }
    return result.length > 0 ? result : null;
  }, [ctxLoading, ctxItems, ctxAreas, products]);


  // Refs to the inline builder's methods
  const areaAddProductRef = useRef<((product: PaletteProduct) => void) | null>(null);
  const areaDropProductToAreaRef = useRef<((areaId: string, product: PaletteProduct) => void) | null>(null);
  const areaDropBundleToAreaRef = useRef<((areaId: string, bundle: any) => void) | null>(null);
  const areaAddZoneRef = useRef<(() => void) | null>(null);
  const areaApplyTemplateRef = useRef<((zoneNames: string[]) => void) | null>(null);
  const areaClearAllRef = useRef<(() => void) | null>(null);

  // Shared PDF product selection state
  const [selectedFromPdf, setSelectedFromPdf] = useState<PdfSelectedProduct[]>([]);
  const [floatingOpen, setFloatingOpen] = useState(false);

  const handleSelectProduct = useCallback((product: Pick<PdfSelectedProduct, "code" | "description" | "price"> & Partial<Pick<PdfSelectedProduct, "costPrice" | "markupPercent">>) => {
    setSelectedFromPdf((prev) => {
      if (prev.some((p) => p.code === product.code)) {
        return prev.filter((p) => p.code !== product.code);
      }
      return [...prev, { ...product, quantity: 1, unitType: "units", costPrice: product.costPrice, markupPercent: product.markupPercent }];
    });
  }, []);

  const updateSelectedItem = useCallback((code: string, updates: Partial<Pick<PdfSelectedProduct, "quantity" | "unitType">>) => {
    setSelectedFromPdf((prev) =>
      prev.map((item) => (item.code === code ? { ...item, ...updates } : item))
    );
  }, []);

  // Wizard trigger item from Visual tab
  const handleOpenWizardFromVisual = useCallback((item: WizardTriggerItem) => {
    setAreaWizardOpen(true);
  }, []);

  // Fetch bundles for Area builder
  const { data: bundles = [] } = useQuery<PaletteBundle[]>({
    queryKey: ["quote-builder-bundles"],
    queryFn: async () => {
      const { data: bundleData, error: bErr } = await supabase.
      from("installation_bundles").
      select("id, name, description, bundle_type, min_btu, max_btu, compatible_brands, is_favorite").
      eq("is_active", true).
      order("name");
      if (bErr) throw bErr;
      if (!bundleData || bundleData.length === 0) return [];

      const { data: itemsData, error: iErr } = await (supabase.from("bundle_items") as any).
      select("id, bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, sort_order, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, suppliers(name))").
      order("sort_order");
      if (iErr) throw iErr;

      const itemsByBundle: Record<string, any[]> = {};
      (itemsData || []).forEach((item: any) => {
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
          } : null
        });
      });

      return bundleData.map((b) => ({
        ...b,
        items: itemsByBundle[b.id] || []
      }));
    },
    staleTime: 60000
  });

  // Add product to basket handler for Visual tab
  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct) => {
    setBaskets((prev) => {
      // Ensure at least one basket exists
      let updated = prev.length > 0 ? [...prev] : [{ id: "basket-1", name: "Zone 1", items: [] }];
      return updated.map((basket) => {
        if (basket.id !== basketId) return basket;
        const existing = basket.items.find((i) => i.product.id === product.id);
        if (existing) {
          return {
            ...basket,
            items: basket.items.map((i) =>
            i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
            )
          };
        }
        return {
          ...basket,
          items: [
          ...basket.items,
          {
            instanceId: `${product.id}-${Date.now()}`,
            product,
            quantity: 1,
            ...(product.sold_in_length && product.price_per_metre ? { length: product.unit_length || 1 } : {})
          }]

        };
      });
    });
  }, []);

  // Handle wizard save — merge new baskets
  const handleWizardSave = useCallback((newBaskets: Basket[]) => {
    setBaskets((prev) => [...prev, ...newBaskets]);
    toast({ title: `Added ${newBaskets.length} zones from Area Quote Builder` });
    setAreaWizardOpen(false);
  }, []);

  // Auto-open wizard when switching to Area tab
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    if (tab === "area") {
      setAreaWizardOpen(true);
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: "linear-gradient(135deg, #1e6bb8 0%, #d0d0d0 100%)",
        backgroundAttachment: "fixed"
      }}>

      <QuoteSharedHeader onBack={() => navigate(mode === "agent" ? "/field" : "/admin/quotes")} />

      {/* Builder mode tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="shrink-0">
        <div className="flex items-center justify-center py-1.5 bg-black/10">
          <TabsList className="h-8 bg-white/10">
            <TabsTrigger value="normal" className="text-xs text-white data-[state=active]:bg-white data-[state=active]:text-foreground px-4">Build</TabsTrigger>
            <TabsTrigger value="visual" className="text-xs text-white data-[state=active]:bg-white data-[state=active]:text-foreground px-4">Visual PDF</TabsTrigger>
            <TabsTrigger value="area" className="text-xs text-white data-[state=active]:bg-white data-[state=active]:text-foreground px-4">Build Area Quote</TabsTrigger>
          </TabsList>
        </div>
      </Tabs>













      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {ctxLoading && (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
              <p className="text-sm text-white/80">Loading quote…</p>
            </div>
          </div>
        )}
        {!ctxLoading && activeTab === "normal" &&
        <div className="h-full flex">
            <div className="flex-1 min-w-0 overflow-y-auto">
              <QuoteBuilderTab
                initialBaskets={initialBaskets}
                onBasketsChange={setBaskets}
                pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
                onPopOutSelected={() => setFloatingOpen(true)}
                areaBuilderNode={
                  <AreaQuoteBuilderInline
                    products={products}
                    bundles={bundles}
                    onSave={handleWizardSave}
                    onPdfSearch={pdfSearchRef.current || undefined}
                    onAreasChange={setWizardAreas}
                    onAddProductRef={areaAddProductRef}
                    onDropProductToAreaRef={areaDropProductToAreaRef}
                    onDropBundleToAreaRef={areaDropBundleToAreaRef}
                    onAddAreaRef={areaAddZoneRef}
                    onApplyTemplateRef={areaApplyTemplateRef}
                    onClearAllRef={areaClearAllRef}
                    pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
                  />
                }
                areaAddZone={() => areaAddZoneRef.current?.()}
                areaApplyTemplate={(zones) => areaApplyTemplateRef.current?.(zones)}
                areaClearAll={() => areaClearAllRef.current?.()}
                areaCount={wizardAreas.length}
                areaDropProductToArea={(areaId, product) => areaDropProductToAreaRef.current?.(areaId, product)}
                areaDropBundleToArea={(areaId, bundle) => areaDropBundleToAreaRef.current?.(areaId, bundle)}
              />
            </div>
            <div className="w-[320px] shrink-0 border-l overflow-y-auto p-3 mx-[5px] my-[4px] bg-transparent">
              <QuoteSummaryPanel baskets={baskets} />
            </div>
          </div>
        }
        {!ctxLoading && activeTab === "visual" &&
        <div className="h-full flex">
            <div className="flex-1 min-w-0 overflow-hidden">
              <VisualCatalogPanel
              open={true}
              onClose={() => {}}
              baskets={baskets}
              onAddProductToBasket={addProductToBasket}
              products={products}
              isDragging={false}
              onOpenWizard={handleOpenWizardFromVisual}
              pdfSearchRef={pdfSearchRef}
              wizardOpen={areaWizardOpen}
              pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }} />

            </div>
            <div className="w-[320px] shrink-0 border-l overflow-y-auto bg-card p-3">
              <QuoteSummaryPanel baskets={baskets} />
            </div>
          </div>
        }
        {!ctxLoading && activeTab === "area" &&
        <div className="h-full flex">
            {/* Product Palette - left sidebar */}
            <div className="w-[280px] shrink-0 flex flex-col min-h-0 overflow-hidden pl-2 py-1">
              <ProductPalette
                products={areaFilteredProducts}
                isLoading={false}
                searchQuery={areaSearch}
                onSearchChange={setAreaSearch}
                categoryFilter={areaCategoryFilter}
                onCategoryChange={setAreaCategoryFilter}
                isDragging={false}
                favorites={areaFavorites}
                onToggleFavorite={() => {}}
                usageMap={areaUsageMap}
                bundles={bundles}
                baskets={[]}
                onAddProductToBasket={(_basketId, product) => {
                  areaAddProductRef.current?.(product);
                }}
                pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
                onPopOutSelected={() => setFloatingOpen(true)}
              />
            </div>
            {/* Area Builder - center */}
            <div className="flex-1 min-w-0 overflow-hidden p-1">
              <AreaQuoteBuilderInline
                products={products}
                bundles={bundles}
                onSave={handleWizardSave}
                onPdfSearch={pdfSearchRef.current || undefined}
                onAreasChange={setWizardAreas}
                onAddProductRef={areaAddProductRef}
                pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
              />
            </div>
            {/* Summary - right sidebar */}
            <div className="w-[320px] shrink-0 border-l overflow-y-auto bg-card p-3">
              <AreaQuoteSummary areas={wizardAreas} />
            </div>
          </div>
        }
      </div>

      {/* Floating selected items panel */}
      {floatingOpen && (
        <FloatingSelectedItems
          pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
          onClose={() => setFloatingOpen(false)}
        />
      )}

      {/* Area wizard popup (works across all tabs) */}
      <QuoteBuilderPopup
        open={areaWizardOpen}
        onClose={() => setAreaWizardOpen(false)}
        products={products}
        bundles={bundles}
        onSave={handleWizardSave}
        triggerItem={null} />

    </div>);

}

/* ─── Outer wrapper: loads existing / finds latest draft / creates new, then mounts provider ─── */
const AdminQuoteBuilderPageUnified = ({ mode = "admin" }: { mode?: QuoteBuilderMode }) => {
  const [searchParams] = useSearchParams();
  const paramQuoteId = searchParams.get("quoteId");
  const paramLeadId = searchParams.get("leadId");
  const paramCustomerId = searchParams.get("customerId");
  const [quoteId, setQuoteId] = useState<string | null>(paramQuoteId);
  const [creating, setCreating] = useState(!paramQuoteId);
  const navigate = useNavigate();

  // Resolve the quote to open: prefer explicit quoteId; else find an
  // existing draft for the lead/customer (empty-quote safeguard); else
  // create a new draft. This guarantees one quote per lead/customer/draft
  // instead of a fresh blank quote every time.
  useEffect(() => {
    if (paramQuoteId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) {
          toast({ title: "You must be logged in", variant: "destructive" });
          navigate(mode === "agent" ? "/field" : "/admin/quotes");
          return;
        }

        // 1) Existing draft for this lead? Reuse it.
        if (paramLeadId) {
          const { data: existing } = await supabase
            .from("quotes")
            .select("id")
            .eq("lead_id", paramLeadId)
            .eq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!cancelled && existing?.id) {
            setQuoteId(existing.id);
            setCreating(false);
            return;
          }
        }

        // 2) Existing draft for this customer (no lead attached)? Reuse it.
        if (!paramLeadId && paramCustomerId) {
          const { data: existing } = await supabase
            .from("quotes")
            .select("id")
            .eq("customer_id", paramCustomerId)
            .is("lead_id", null)
            .eq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!cancelled && existing?.id) {
            setQuoteId(existing.id);
            setCreating(false);
            return;
          }
        }

        // 3) Nothing to reuse — create a fresh draft, pre-linking lead/customer.
        const insertPayload: Record<string, unknown> = {
          sales_engineer_id: userId,
          status: "draft",
          subtotal: 0,
          vat_rate: 0.15,
          vat_amount: 0,
          total: 0,
        };
        if (paramLeadId) insertPayload.lead_id = paramLeadId;
        if (paramCustomerId) insertPayload.customer_id = paramCustomerId;

        const { data, error } = await (supabase.from("quotes") as any)
          .insert(insertPayload)
          .select("id")
          .single();

        if (error) throw error;
        if (!cancelled) {
          setQuoteId(data.id);
          setCreating(false);
        }
      } catch (err: any) {
        toast({ title: "Failed to open quote", description: err.message, variant: "destructive" });
        if (!cancelled) navigate(mode === "agent" ? "/field" : "/admin/quotes");
      }
    })();

    return () => { cancelled = true; };
  }, [paramQuoteId, paramLeadId, paramCustomerId, navigate, mode]);

  if (creating || !quoteId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1e6bb8 0%, #d0d0d0 100%)" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <p className="text-sm text-white/80">Preparing quote...</p>
        </div>
      </div>);

  }

  return (
    <QuoteProvider quoteId={quoteId}>
      <UnifiedQuoteBuilderInner mode={mode} />
    </QuoteProvider>);

};

export default AdminQuoteBuilderPageUnified;
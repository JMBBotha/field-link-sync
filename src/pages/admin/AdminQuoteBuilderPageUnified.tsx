/**
 * Unified Quote Builder Page — wraps Normal / Visual / Area builders
 * in a shared header with tabs. Each tab renders the real builder component.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { PdfSelectedProduct } from "@/types/pdfSelection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users, X, Loader2, Mic, ChevronDown, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { useIsTabletOrBelow } from "@/hooks/use-mobile";
import { formatRand } from "@/utils/formatRand";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import VoiceQuoteDialog from "@/components/quoting/VoiceQuoteDialog";
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
import FloatingSelectedItems from "@/components/catalog/quote-builder/FloatingSelectedItems";
import type { QuoteArea as WizardQuoteArea } from "@/components/catalog/quote-builder/quoteWizardTypes";
import { createEmptyArea, computeAreaSubtotal, detectBTU } from "@/components/catalog/quote-builder/quoteWizardTypes";
import type { PaletteBundle } from "@/components/catalog/quote-builder/ProductPalette";
import { useQuoteLiveTotals } from "@/stores/quoteLiveTotalsStore";
import { areasToBaskets } from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import { computeQuoteTotals } from "@/utils/quoteTransformers";
import { computeBasketsQuoteTotals } from "@/utils/quoteBasketTotals";
import { pdfItemToPaletteProduct } from "@/utils/pdfItemToProduct";
import { persistQuoteFromBaskets } from "@/utils/persistQuoteFromBaskets";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";


export type QuoteBuilderMode = "admin" | "agent";

/* ─── Shared Header with client selector ─── */
function QuoteSharedHeader({ onBack }: {onBack: () => void;}) {
  const { meta, updateQuote, areas, items } = useQuoteContext();
  const live = useQuoteLiveTotals();
  const { data: clients = [] } = useUnifiedClients();
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedClient = useMemo(() => {
    if (!meta?.customer_id) return null;
    return clients.find((c) => c.id === meta.customer_id || c.customer_id === meta.customer_id) || null;
  }, [clients, meta?.customer_id]);

  /**
   * Single source of truth for the client name: the customers record. Any
   * name snapshotted onto the quote row (`quotes.customer_name`) is only a
   * fallback for quotes with no linked customer, so stale/misspelt snapshots
   * can never diverge from the document view.
   */
  const clientLabel = selectedClient?.name || meta?.customer_name || null;

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

  const dbTotals = useMemo(() => computeQuoteTotals(items, areas), [items, areas]);

  // Prefer live in-progress builder totals so header reflects unsaved edits
  // BEFORE they hit the DB. Falls back to persisted totals when idle.
  const totalItems = live.hasLiveData ? live.items : dbTotals.itemCount;
  const zoneCount = live.hasLiveData ? live.zones : dbTotals.zoneCount;
  const totalCost = live.hasLiveData ? live.subtotal : dbTotals.subtotal;


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
          {clientLabel ?
          <div className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium truncate max-w-[150px]">{clientLabel}</span>
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
              className="h-8 w-36 sm:w-48 text-xs rounded-lg bg-white/10 border-white/20 text-white placeholder:text-white/50" />

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
        clientLabel ?
        <span className="hidden lg:block text-[10px] text-white/50 font-mono">Draft – creating…</span> : null
        }
      </div>
    </header>);

}

/* ─── Inner content (needs context) ─── */
function UnifiedQuoteBuilderInner({ mode = "admin" }: { mode?: QuoteBuilderMode }) {
  const navigate = useNavigate();
  const { items: ctxItems, areas: ctxAreas, loading: ctxLoading, quoteId, meta } = useQuoteContext();
  const [activeTab, setActiveTab] = useState("normal");
  const [areaWizardOpen, setAreaWizardOpen] = useState(false);
  const pdfSearchRef = useRef<((term: string) => void) | null>(null);

  // Shared baskets state for cross-tab data
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [wizardAreas, setWizardAreas] = useState<WizardQuoteArea[]>([]);
  const [popupPreviewBaskets, setPopupPreviewBaskets] = useState<Basket[]>([]);

  // Single canonical source of truth for on-screen totals while the user is
  // editing an unsaved quote: merge Normal-tab baskets with the inline
  // wizard's areas-as-baskets. Every display (header pill, "Quote Total" bar,
  // sidebar) reads from THIS list — no parallel calculations.
  const wizardBaskets = useMemo(() => areasToBaskets(wizardAreas), [wizardAreas]);

  // Tap-to-add targets for the Area tab palette: each wizard area becomes a
  // pickable "zone" so tapping a product adds it without drag-and-drop.
  const areaPickerBaskets = useMemo<Basket[]>(() => {
    if (wizardAreas.length === 0) {
      // Synthetic target so tap-to-add works before any area exists — the
      // callback routes "__auto__" to the builder's auto-area add.
      return [{ id: "__auto__", name: "New area (auto)", items: [] }];
    }
    return wizardAreas.map((a) => ({
      id: a.id,
      name: a.name,
      // Only .length is read by the palette's zone-picker badge
      items: Array(a.acUnits.length + a.materials.length + a.consumables.length + a.brackets.length).fill(null) as unknown as Basket["items"],
    }));
  }, [wizardAreas]);
  /**
   * Both the Normal-tab baskets and the inline Area builder hydrate from the
   * SAME persisted quote_items when an existing quote is opened, so naively
   * concatenating them double-counts every stored line (the "2 items · 2 zones"
   * stale-total bug). Wizard instanceIds embed the source quote_item id
   * (`wizard-<areaId>-<kind>-<itemId>`), so drop wizard lines that are already
   * represented in `baskets` and recompute fresh from what remains.
   */
  const displayBaskets = useMemo(() => {
    const hydratedIds = new Set<string>();
    baskets.forEach((b) => b.items.forEach((i) => hydratedIds.add(i.instanceId)));

    const dedupedWizard = hydratedIds.size
      ? wizardBaskets
          .map((b) => ({
            ...b,
            items: b.items.filter((i) => {
              const m = i.instanceId.match(/-(?:ac|mat|con)-(.+)$/);
              const sourceId = m ? m[1] : i.instanceId;
              return !hydratedIds.has(sourceId) && !hydratedIds.has(i.instanceId);
            }),
          }))
          .filter((b) => b.items.length > 0)
      : wizardBaskets;

    return [...baskets, ...dedupedWizard, ...popupPreviewBaskets];
  }, [baskets, wizardBaskets, popupPreviewBaskets]);
  const displayQuoteTotals = useMemo(
    () => computeBasketsQuoteTotals(displayBaskets),
    [displayBaskets],
  );

  // Publish live in-progress totals so the header/summary reflect unsaved
  // wizard/basket edits BEFORE they're persisted. Cleared on unmount.
  const setLive = useQuoteLiveTotals((s) => s.set);
  const resetLive = useQuoteLiveTotals((s) => s.reset);
  useEffect(() => {
    setLive({
      items: displayQuoteTotals.itemCount,
      zones: displayQuoteTotals.zoneCount,
      subtotal: displayQuoteTotals.subtotal,
    });
  }, [displayQuoteTotals, setLive]);
  useEffect(() => () => resetLive(), [resetLive]);


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
    // Real = non-placeholder AND has qty/rate. Zero-value non-placeholder rows
    // must not hydrate (mirrors reuse rule).
    const realItems = ctxItems.filter(
      (i) =>
        i.source !== "legacy_placeholder" &&
        ((i.quantity ?? 0) > 0 || (i.unit_price ?? 0) > 0 || (i.total_price ?? 0) > 0)
    );
    if (realItems.length === 0 && ctxAreas.length === 0) {
      // No real data: start EMPTY so the inline Area/Wizard builder is the
      // sole source of zones. Avoids a ghost "Zone 1" appearing alongside
      // wizard-applied templates (root cause of the totals split-brain).
      return [];
    }

    const productById = new Map(products.map((p) => [p.id, p]));
    const metadataMarkup = (it: typeof ctxItems[number]) => {
      const markup = Number((it.metadata as Record<string, unknown>)?.markup_percent);
      return Number.isFinite(markup) && markup > 0 ? markup : 0;
    };
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
      markup_percent: metadataMarkup(it),
      default_markup_percent: metadataMarkup(it),
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
    for (const it of realItems) {
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
    return result;
  }, [ctxLoading, ctxItems, ctxAreas, products]);


  /**
   * Seed the Area/Wizard builder with real DB items so the Areas step shows
   * the actual line items rather than the "Additional Items/Services"
   * placeholder. We classify each item into acUnits / materials / consumables
   * based on category and length.
   */
  const initialWizardAreas = useMemo<WizardQuoteArea[] | null>(() => {
    if (ctxLoading) return null;
    // Same "real item" rule as reuse/hydration guards.
    const realItems = ctxItems.filter(
      (i) =>
        i.source !== "legacy_placeholder" &&
        !i.parent_item_id &&
        ((i.quantity ?? 0) > 0 || (i.unit_price ?? 0) > 0 || (i.total_price ?? 0) > 0)
    );
    if (realItems.length === 0 && ctxAreas.length === 0) return null;
    const productById = new Map(products.map((p) => [p.id, p]));
    const metadataMarkup = (it: typeof ctxItems[number]) => {
      const markup = Number((it.metadata as Record<string, unknown>)?.markup_percent);
      return Number.isFinite(markup) && markup > 0 ? markup : 0;
    };
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
      markup_percent: metadataMarkup(it),
      default_markup_percent: metadataMarkup(it),
      is_pinned: false,
      pin_order: null,
      price_per_metre: it.length ? it.unit_price : null,
      sold_in_length: !!it.length,
      unit_length: it.length || null,
      pipe_size: null,
      is_material_favorite: false,
      pack_qty: null,
    } as unknown as PaletteProduct);
    // Group items by area_id (null → default "General" bucket)
    const buckets = new Map<string | null, typeof ctxItems>();
    for (const a of ctxAreas) buckets.set(a.id, [] as any);
    for (const it of realItems) {
      const key = it.area_id && buckets.has(it.area_id) ? it.area_id : null;
      if (!buckets.has(key)) buckets.set(key, [] as any);
      (buckets.get(key) as any).push(it);
    }
    const areaNameFor = (id: string | null): string => {
      if (!id) return ctxAreas.length === 0 ? "Additional Items/Services" : "General";
      return ctxAreas.find((a) => a.id === id)?.name || "General";
    };
    const result: WizardQuoteArea[] = [];
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
      select("id, bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, sort_order, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, cost_price, default_markup_percent, supplier_discount_percent, markup_percent, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty, suppliers(name))").
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
            unit_length: sp.unit_length || null,
            cost_price: sp.cost_price ?? 0,
            default_markup_percent: sp.default_markup_percent ?? 35,
            supplier_discount_percent: sp.supplier_discount_percent ?? null,
            markup_percent: sp.markup_percent ?? null,
            unit_type: sp.unit_type || null,
            price_per_unit_qty: sp.price_per_unit_qty ?? 1,
            price_per_unit_label: sp.price_per_unit_label || "each",
            allows_decimal_qty: sp.allows_decimal_qty ?? false,
            qty_step: sp.qty_step ?? 1,
            min_qty: sp.min_qty ?? 1
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

  /** Push every PDF-selected product into the shared baskets (one quote). */
  const addSelectedPdfToQuote = useCallback(() => {
    if (selectedFromPdf.length === 0) return;
    const converted = selectedFromPdf.map((item) => ({
      product: pdfItemToPaletteProduct(item),
      quantity: item.quantity || 1,
    }));
    setBaskets((prev) => {
      const list = prev.length > 0 ? [...prev] : [{ id: "basket-1", name: "Zone 1", items: [] as Basket["items"] }];
      const targetId = list[0].id;
      return list.map((basket) => {
        if (basket.id !== targetId) return basket;
        let items = [...basket.items];
        converted.forEach(({ product, quantity }) => {
          const existing = items.find((i) => i.product.id === product.id);
          if (existing) {
            items = items.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + quantity } : i));
          } else {
            items.push({ instanceId: `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, product, quantity });
          }
        });
        return { ...basket, items };
      });
    });
    toast({ title: `Added ${selectedFromPdf.length} item(s) to the quote` });
    setSelectedFromPdf([]);
  }, [selectedFromPdf]);

  // ---- Build with voice -------------------------------------------------
  // Voice items are merged into the SAME shared baskets every tab uses, so
  // they persist through persistQuoteFromBaskets like any other line item.
  const [voiceOpen, setVoiceOpen] = useState(false);

  const addVoiceItems = useCallback((entries: Array<{ product: PaletteProduct; quantity: number }>) => {
    if (!entries.length) return;
    setBaskets((prev) => {
      const list = prev.length > 0 ? [...prev] : [{ id: "basket-1", name: "Zone 1", items: [] as Basket["items"] }];
      const targetId = list[0].id;
      return list.map((basket) => {
        if (basket.id !== targetId) return basket;
        const items = [...basket.items];
        entries.forEach(({ product, quantity }, idx) => {
          items.push({
            instanceId: `${product.id}-${Date.now()}-${idx}`,
            product,
            quantity: quantity || 1,
          });
        });
        return { ...basket, items };
      });
    });
  }, []);

  // Handle wizard save — merge new baskets
  const handleWizardSave = useCallback((newBaskets: Basket[]) => {
    setBaskets((prev) => [...prev, ...newBaskets]);
    setPopupPreviewBaskets([]);
    toast({ title: `Added ${newBaskets.length} zones from Area Quote Builder` });
    setAreaWizardOpen(false);
  }, []);

  // Switching tabs: the Area tab uses the inline builder, no modal popup
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);


  /* ── Generate Quote: persist the merged basket state (Build + Visual PDF +
     Area tabs) into the ONE unified quote, then open the send-to-client flow ── */
  const [sendOpen, setSendOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  /* ── Mobile/tablet accordion for the Area tab: one full-screen scrollable
     section at a time (palette / areas / summary) ── */
  const isCompact = useIsTabletOrBelow();
  type AreaSectionKey = "palette" | "areas" | "summary";
  const [openSections, setOpenSections] = useState<Record<AreaSectionKey, boolean>>({
    palette: true,
    areas: false,
    summary: false,
  });
  const toggleSection = useCallback((key: AreaSectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  /* True full-page mode for the Product Palette: hides the Area Quote and
     Quote Summary headers/content entirely so the palette fills the screen */
  const [paletteMaximized, setPaletteMaximized] = useState(false);

  const handleGenerateQuote = useCallback(async () => {
    if (!quoteId) return;
    if (displayQuoteTotals.itemCount === 0) {
      toast({ title: "Nothing to quote", description: "Add at least one line item first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const validIds = new Set(products.map((p) => p.id));
      await persistQuoteFromBaskets(quoteId, displayBaskets, validIds);
      // Send = shareable client link. Ensure public_token exists and move a
      // draft to sent. Never touch accepted/declined/viewed statuses.
      const { data: q } = await supabase
        .from("quotes")
        .select("public_token, status, sent_at")
        .eq("id", quoteId)
        .maybeSingle();
      const patch: Record<string, unknown> = {};
      if (!q?.public_token) patch.public_token = crypto.randomUUID();
      if (q?.status === "draft") {
        patch.status = "sent";
        patch.sent_at = new Date().toISOString();
      } else if (!q?.sent_at && q?.status !== "accepted" && q?.status !== "declined") {
        patch.sent_at = new Date().toISOString();
      }
      if (Object.keys(patch).length) {
        await supabase.from("quotes").update(patch).eq("id", quoteId);
      }
      toast({ title: "Quote saved", description: "All builder tabs merged into one quote." });
      setSendOpen(true);
    } catch (err) {
      toast({
        title: "Couldn't save quote",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [quoteId, displayBaskets, displayQuoteTotals.itemCount, products]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background">

      <QuoteSharedHeader onBack={() => navigate(mode === "agent" ? "/field" : "/admin/quotes")} />

      <VoiceQuoteDialog
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        products={products}
        quoteId={quoteId}
        onConfirm={addVoiceItems}
      />

      {/* Builder mode tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="shrink-0">
        <div className="flex flex-wrap items-center justify-center gap-y-1 py-1.5 bg-muted/40">
          <TabsList className="h-8 bg-muted">
            <TabsTrigger value="normal" className="text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4">Build</TabsTrigger>
            <TabsTrigger value="visual" className="text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4">Visual PDF</TabsTrigger>
            <TabsTrigger value="area" className="text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4">Build Area Quote</TabsTrigger>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setVoiceOpen(true)}
              className="h-7 w-7 ml-0.5 border-transparent bg-transparent hover:bg-accent"
              title="Speak your line items"
            >
              <Mic className="h-3.5 w-3.5" />
            </Button>
          </TabsList>
        </div>
      </Tabs>

      {/* Post-acceptance: deposit invoice + hand over to installation */}
      {quoteId && meta?.status === "accepted" && (
        <div className="shrink-0 px-3 pb-2">
          <AcceptedWorkSection quoteId={quoteId} />
        </div>
      )}

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
        <div className="h-full flex flex-col lg:flex-row overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
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
                    initialAreas={initialWizardAreas}
                    onGenerateQuote={handleGenerateQuote}
                    generating={generating}
                  />
                }
                areaAddZone={() => areaAddZoneRef.current?.()}
                areaApplyTemplate={(zones) => areaApplyTemplateRef.current?.(zones)}
                areaClearAll={() => areaClearAllRef.current?.()}
                areaCount={wizardAreas.length}
                areaDropProductToArea={(areaId, product) => areaDropProductToAreaRef.current?.(areaId, product)}
                areaDropBundleToArea={(areaId, bundle) => areaDropBundleToAreaRef.current?.(areaId, bundle)}
                extraBaskets={wizardBaskets}
                quoteTotals={displayQuoteTotals}
              />
            </div>
            <div className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l overflow-y-auto p-3 bg-card max-h-[38vh] lg:max-h-none">
              <QuoteSummaryPanel baskets={displayBaskets} totals={displayQuoteTotals} quoteId={quoteId} onGenerateQuote={handleGenerateQuote} />

            </div>
          </div>
        }
        {!ctxLoading && activeTab === "visual" &&
        <div className="h-full flex flex-col lg:flex-row overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
              <VisualCatalogPanel
              open={true}
              onClose={() => setActiveTab("normal")}
              baskets={baskets}
              onAddProductToBasket={addProductToBasket}
              onAddSelectedToQuote={addSelectedPdfToQuote}
              products={products}
              isDragging={false}
              onOpenWizard={handleOpenWizardFromVisual}
              pdfSearchRef={pdfSearchRef}
              wizardOpen={areaWizardOpen}
              pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }} />

            </div>
            <div className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l overflow-y-auto bg-card p-3 max-h-[38vh] lg:max-h-none">
              <QuoteSummaryPanel baskets={displayBaskets} totals={displayQuoteTotals} quoteId={quoteId} onGenerateQuote={handleGenerateQuote} />
            </div>
          </div>
        }
        {!ctxLoading && activeTab === "area" &&
        <div className="h-full flex flex-col lg:flex-row overflow-hidden">
            {/* Product Palette — collapsible full-screen section on mobile, left sidebar on desktop */}
            {isCompact && (
              <div className="shrink-0 flex items-center w-full border-b bg-card">
                <button
                  type="button"
                  onClick={() => {
                    if (paletteMaximized) return;
                    toggleSection("palette");
                  }}
                  className="flex-1 flex items-center justify-between px-3 py-2 text-xs font-semibold text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    {openSections.palette || paletteMaximized ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Product Palette
                  </span>
                  <span className="text-[10px] font-normal text-muted-foreground">{areaFilteredProducts.length} items</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaletteMaximized((v) => !v)}
                  className="shrink-0 flex items-center gap-1 px-3 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground border-l"
                  title={paletteMaximized ? "Exit full screen" : "Full screen"}
                >
                  {paletteMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {paletteMaximized ? "Exit" : "Full page"}
                </button>
              </div>
            )}
            <div className={`w-full lg:w-[280px] lg:shrink-0 flex flex-col min-h-0 overflow-hidden pl-2 py-1 lg:border-b-0 ${
              isCompact ? (paletteMaximized || openSections.palette ? "flex-1" : "hidden") : ""
            }`}>
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
                baskets={areaPickerBaskets}
                onAddProductToBasket={(areaId, product) => {
                  if (areaId === "__auto__") areaAddProductRef.current?.(product);
                  else areaDropProductToAreaRef.current?.(areaId, product);
                }}
                onAddBundleToBasket={(areaId, bundle) => {
                  if (areaId === "__auto__") {
                    toast({ title: "Create an area first", description: "Add an area, then tap the bundle to apply it." });
                    return;
                  }
                  areaDropBundleToAreaRef.current?.(areaId, bundle);
                }}
                pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
                onPopOutSelected={() => setFloatingOpen(true)}
              />
            </div>

            {/* Area Builder — center / collapsible full-screen section on mobile */}
            {isCompact && !paletteMaximized && (
              <button
                type="button"
                onClick={() => toggleSection("areas")}
                className="shrink-0 flex items-center justify-between w-full px-3 py-2 border-b bg-card text-xs font-semibold text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  {openSections.areas ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Area Quote
                </span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {wizardAreas.length} area{wizardAreas.length !== 1 ? "s" : ""}
                </span>
              </button>
            )}
            <div className={`min-w-0 min-h-0 overflow-hidden p-1 ${
              isCompact ? (openSections.areas && !paletteMaximized ? "flex-1" : "hidden") : "flex-1"
            }`}>
              <AreaQuoteBuilderInline
                products={products}
                bundles={bundles}
                onSave={handleWizardSave}
                onPdfSearch={pdfSearchRef.current || undefined}
                onAreasChange={setWizardAreas}
                onAddProductRef={areaAddProductRef}
                onDropProductToAreaRef={areaDropProductToAreaRef}
                onDropBundleToAreaRef={areaDropBundleToAreaRef}
                pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
                initialAreas={initialWizardAreas}
                onGenerateQuote={handleGenerateQuote}
                generating={generating}
              />
            </div>

            {/* Summary — collapsible full-screen section on mobile, right sidebar on desktop */}
            {isCompact && !paletteMaximized && (
              <button
                type="button"
                onClick={() => toggleSection("summary")}
                className="shrink-0 flex items-center justify-between w-full px-3 py-2 border-t bg-card text-xs font-semibold text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  {openSections.summary ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Quote Summary
                </span>
                <span className="text-[11px] font-bold text-primary tabular-nums">
                  {formatRand(displayQuoteTotals.total)}
                </span>
              </button>
            )}
            <div className={`w-full lg:w-[320px] lg:shrink-0 lg:border-t-0 lg:border-l overflow-y-auto bg-card p-3 lg:max-h-none ${
              isCompact ? (openSections.summary && !paletteMaximized ? "flex-1 min-h-0" : "hidden") : "shrink-0 border-t"
            }`}>
              <QuoteSummaryPanel baskets={displayBaskets} totals={displayQuoteTotals} quoteId={quoteId} onGenerateQuote={handleGenerateQuote} />
            </div>
          </div>
        }
      </div>

      {/* Floating selected items panel */}
      {floatingOpen && (
        <FloatingSelectedItems
          pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
          onClose={() => setFloatingOpen(false)}
          onAddSelectedToQuote={addSelectedPdfToQuote}
        />
      )}

      {/* Area wizard popup (works across all tabs) */}
      <QuoteBuilderPopup
        open={areaWizardOpen}
        onClose={() => {
          setAreaWizardOpen(false);
          setPopupPreviewBaskets([]);
        }}
        products={products}
        bundles={bundles}
        onSave={handleWizardSave}
        onLivePreview={(preview) => {
          setPopupPreviewBaskets(preview.map((b) => ({ ...b, id: `wizard-popup-${b.id}` })));
        }}
        triggerItem={null} />

      {/* Send the finalised quote to the client (email / WhatsApp) */}
      <SendQuoteDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        quoteId={quoteId}
        quoteNumber={meta?.quote_number || "Draft"}
        customerId={meta?.customer_id ?? null}
        customerName={meta?.customer_name || ""}
      />

      {generating && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-2 rounded-lg bg-card px-4 py-3 text-sm text-foreground shadow-xl">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving quote…
          </div>
        </div>
      )}

    </div>);

}

/* ─── Client picker shown when a new quote is requested without a client ─── */
function NewQuoteClientPicker({
  onPicked,
  onCancel,
}: {
  onPicked: (customerId: string, customerName: string) => void;
  onCancel: () => void;
}) {
  const { data: clients = [], isLoading } = useUnifiedClients();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    contact_person: "",
    address: "",
  });
  const [dupes, setDupes] = useState<Array<{ id: string; name: string; phone: string | null; email: string | null }>>([]);

  const filtered = useMemo(() => {
    const list = clients.filter((c) => !!c.customer_id);
    if (!search.trim()) return list.slice(0, 30);
    const q = search.toLowerCase();
    return list
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [clients, search]);

  useEffect(() => {
    if (!showForm) return;
    const name = form.name.trim();
    if (name.length < 2) {
      setDupes([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle();
      const companyId = (profile?.company_id as string | null) || null;
      if (!companyId) return;
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, email")
        .eq("company_id", companyId)
        .ilike("name", `%${name}%`)
        .limit(5);
      setDupes((data as any[]) || []);
    }, 300);
    return () => clearTimeout(handle);
  }, [form.name, showForm]);

  const canSubmit =
    form.name.trim().length > 0 &&
    (form.phone.trim().length > 0 || form.email.trim().length > 0) &&
    !submitting;

  const resetForm = () => {
    setForm({ name: "", phone: "", email: "", contact_person: "", address: "" });
    setDupes([]);
  };

  const handleCreate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("You must be logged in.");
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      const companyId = (profile?.company_id as string | null) || null;
      if (!companyId) throw new Error("Your account is not linked to a company.");

      const name = form.name.trim();
      const payload: Record<string, unknown> = {
        name,
        first_name: name.split(" ")[0] || name,
        last_name: name.split(" ").slice(1).join(" ") || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        primary_address_line1: form.address.trim() || null,
        notes: form.contact_person.trim() ? `Contact: ${form.contact_person.trim()}` : null,
        company_id: companyId,
        created_by: userId,
        lead_source: "quote_picker",
        status: "lead",
      };

      const { data, error } = await (supabase.from("customers") as any)
        .insert(payload)
        .select("id, name")
        .single();
      if (error) throw error;
      onPicked(data.id as string, data.name as string);
    } catch (err: any) {
      toast({
        title: "Failed to add client",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md rounded-2xl bg-background shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {showForm ? "Add new client" : "Select a client"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {showForm ? "Fields marked * are required." : "A quote must be linked to a client before it can be created."}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!showForm ? (
          <>
            <div className="p-4">
              <Input
                autoFocus
                placeholder="Search by name, phone or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border-t">
              {isLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Loading clients…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No matching clients. Use "Add new client" below.
                </div>
              ) : (
                filtered.map((c) => {
                  const resolvedId =
                    c.customer_id && !String(c.customer_id).startsWith("lead-")
                      ? c.customer_id
                      : !String(c.id).startsWith("lead-")
                      ? c.id
                      : null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!resolvedId}
                      onClick={() => {
                        if (!resolvedId) return;
                        onPicked(resolvedId, c.name);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-muted/50 border-b last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.phone}
                        {c.email ? ` · ${c.email}` : ""}
                        {!resolvedId ? " · (lead-only — create customer first)" : ""}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
            <div className="p-3 border-t bg-muted/30">
              <Button
                type="button"
                variant="outline"
                className="w-full h-9"
                onClick={() => setShowForm(true)}
              >
                + Add new client
              </Button>
            </div>
          </>
        ) : (
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1">
              <label className="text-xs font-medium">Name *</label>
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Client or company name"
                className="h-9 text-sm"
              />
            </div>
            {dupes.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 space-y-1">
                <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                  Similar existing clients:
                </p>
                {dupes.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{d.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {d.phone}{d.email ? ` · ${d.email}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => onPicked(d.id, d.name)}
                    >
                      Use existing
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="082 123 4567"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="name@example.com"
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Contact person</label>
              <Input
                value={form.contact_person}
                onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))}
                placeholder="Optional"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Address / Suburb</label>
              <Input
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                placeholder="Optional"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-9"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                disabled={submitting}
              >
                Back to list
              </Button>
              <Button
                type="button"
                className="flex-1 h-9"
                onClick={handleCreate}
                disabled={!canSubmit}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create & continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Outer wrapper: loads existing / finds latest draft / creates new, then mounts provider ─── */
const AdminQuoteBuilderPageUnified = ({ mode = "admin" }: { mode?: QuoteBuilderMode }) => {
  const [searchParams] = useSearchParams();
  const paramQuoteId = searchParams.get("quoteId");
  const paramLeadId = searchParams.get("leadId");
  const paramCustomerId = searchParams.get("customerId");
  const [quoteId, setQuoteId] = useState<string | null>(paramQuoteId);
  const [creating, setCreating] = useState(!paramQuoteId);
  // Set when the resolver determines it needs a client from the user before it can insert.
  const [needsClient, setNeedsClient] = useState(false);
  // Stash the drafts that should be superseded once the user picks a client & we insert.
  const pendingSupersedeRef = useRef<string[]>([]);
  const navigate = useNavigate();

  // Insert the draft with a resolved customer_id, then supersede any stale drafts.
  const createDraft = useCallback(
    async (userId: string, resolvedCustomerId: string, toSupersede: string[], customerName?: string) => {
      if (!resolvedCustomerId) {
        // Guard: never hit the DB trigger with a null customer_id.
        throw new Error("Cannot create quote: no customer linked. Please select a client first.");
      }
      // Resolve the user's company_id — required by the quotes RLS insert
      // policy. Without it Postgres rejects the row before it's written.
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) throw profileErr;

      // Dispatch-calendar path: hang the quote on the sales job — the
      // assigned salesperson owns it, not necessarily the logged-in admin,
      // and the lead's company wins over the profile fallback.
      let salesEngineerId = userId;
      let leadCompanyId: string | null = null;
      if (paramLeadId) {
        const { data: leadRow } = await supabase
          .from("leads")
          .select("assigned_agent_id, company_id")
          .eq("id", paramLeadId)
          .maybeSingle();
        if (leadRow?.assigned_agent_id) salesEngineerId = leadRow.assigned_agent_id as string;
        leadCompanyId = (leadRow?.company_id as string | null) || null;
      }

      const companyId = leadCompanyId || (profile?.company_id as string | null) || null;
      if (!companyId) {
        throw new Error("Your account is not linked to a company. Contact an admin.");
      }

      const insertPayload: Record<string, unknown> = {
        sales_engineer_id: salesEngineerId,
        company_id: companyId,
        status: "draft",
        subtotal: 0,
        vat_rate: 0.15,
        vat_amount: 0,
        total: 0,
        customer_id: resolvedCustomerId,
      };
      if (paramLeadId) insertPayload.lead_id = paramLeadId;
      if (customerName && customerName.trim()) insertPayload.customer_name = customerName.trim();

      // eslint-disable-next-line no-console
      console.log("[QuoteBuilder] Inserting draft payload:", insertPayload);

      const { data, error } = await (supabase.from("quotes") as any)
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[QuoteBuilder] Insert error:", error);
        throw error;
      }


      for (const oldId of toSupersede) {
        await (supabase.from("quotes") as any)
          .update({ status: "superseded", superseded_by: data.id })
          .eq("id", oldId);
      }
      return data.id as string;
    },
    [paramLeadId]
  );

  // Resolve the quote to open: prefer explicit quoteId; else find an
  // existing draft for the lead/customer (empty-quote safeguard); else
  // create a new draft — but only when a customer_id can be resolved.
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

        const RECENT_EMPTY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

        const draftHasRealData = async (draftId: string): Promise<boolean> => {
          const [itemsRes, areasRes] = await Promise.all([
            supabase
              .from("quote_items")
              .select("id, source, quantity, unit_price, total_price")
              .eq("quote_id", draftId),
            supabase.from("quote_areas").select("id").eq("quote_id", draftId),
          ]);
          const realItems = (itemsRes.data ?? []).filter((i: any) => {
            if (!i || i.source === "legacy_placeholder") return false;
            const qty = Number(i.quantity ?? 0);
            const rate = Number(i.unit_price ?? 0);
            const total = Number(i.total_price ?? 0);
            return qty > 0 || rate > 0 || total > 0;
          });
          const realAreas = (areasRes.data ?? []).filter(Boolean);
          return realItems.length > 0 || realAreas.length > 0;
        };

        const isRecentEmptyDraft = (draft: {
          created_at?: string | null;
          sales_engineer_id?: string | null;
        }): boolean => {
          if (draft.sales_engineer_id !== userId) return false;
          if (!draft.created_at) return false;
          const age = Date.now() - new Date(draft.created_at).getTime();
          return age >= 0 && age <= RECENT_EMPTY_WINDOW_MS;
        };

        const supersedeDraft = async (draftId: string, newQuoteId: string) => {
          await (supabase.from("quotes") as any)
            .update({ status: "superseded", superseded_by: newQuoteId })
            .eq("id", draftId);
        };

        // Resolve customer_id up front: explicit param wins; else derive from lead.
        let resolvedCustomerId: string | null = paramCustomerId || null;
        if (!resolvedCustomerId && paramLeadId) {
          const { data: leadRow } = await supabase
            .from("leads")
            .select("customer_id")
            .eq("id", paramLeadId)
            .maybeSingle();
          resolvedCustomerId = (leadRow?.customer_id as string) || null;
        }

        // Fetch recent drafts scoped to this lead/customer.
        const fetchDrafts = async () => {
          if (paramLeadId) {
            // A lead is a sales job: open the latest LIVE quote for it —
            // draft/sent/viewed/accepted all fine, skip superseded.
            const { data: live } = await supabase
              .from("quotes")
              .select("id, created_at, sales_engineer_id, status")
              .eq("lead_id", paramLeadId)
              .neq("status", "superseded")
              .order("created_at", { ascending: false })
              .limit(1);
            if (live && live.length > 0) return live;
            return [];
          }
          if (resolvedCustomerId) {
            const { data } = await supabase
              .from("quotes")
              .select("id, created_at, sales_engineer_id")
              .eq("customer_id", resolvedCustomerId)
              .is("lead_id", null)
              .eq("status", "draft")
              .order("created_at", { ascending: false })
              .limit(5);
            return data ?? [];
          }
          return [];
        };

        const drafts = await fetchDrafts();

        // Pass 1: reuse a draft with real data OR a recent-empty draft of ours.
        const toSupersede: string[] = [];
        for (const d of drafts) {
          // A live (non-draft) quote for this lead is always reopened as-is —
          // never superseded or judged by the empty-draft safeguard.
          if ((d as any).status && (d as any).status !== "draft") {
            if (!cancelled) {
              setQuoteId(d.id);
              setCreating(false);
            }
            return;
          }
          const hasReal = await draftHasRealData(d.id);
          if (hasReal || isRecentEmptyDraft(d as any)) {
            for (const oldId of toSupersede) await supersedeDraft(oldId, d.id);
            if (!cancelled) {
              setQuoteId(d.id);
              setCreating(false);
            }
            return;
          }
          toSupersede.push(d.id);
        }

        // Pass 2: no reusable draft. We must have a customer_id to insert —
        // the DB trigger `enforce_quote_customer_id` rejects NULLs. If none
        // was resolved, prompt the user to pick a client instead of hitting
        // the raw constraint error.
        if (!resolvedCustomerId) {
          if (!cancelled) {
            pendingSupersedeRef.current = toSupersede;
            setNeedsClient(true);
            setCreating(false);
          }
          return;
        }

        const newId = await createDraft(userId, resolvedCustomerId, toSupersede);
        if (!cancelled) {
          setQuoteId(newId);
          setCreating(false);
        }
      } catch (err: any) {
        toast({
          title: "Failed to open quote",
          description: err?.message || "Please try again.",
          variant: "destructive",
        });
        if (!cancelled) navigate(mode === "agent" ? "/field" : "/admin/quotes");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paramQuoteId, paramLeadId, paramCustomerId, navigate, mode, createDraft]);

  const handleClientPicked = useCallback(
    async (customerId: string, customerName?: string) => {
      console.log("[QuoteBuilder] handleClientPicked received customerId:", customerId);
      if (!customerId || String(customerId).startsWith("lead-")) {
        toast({
          title: "Invalid client selection",
          description: "That entry has no customer record yet. Create the customer first from the Customers page.",
          variant: "destructive",
        });
        return;
      }
      setNeedsClient(false);
      setCreating(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) throw new Error("You must be logged in.");
        const newId = await createDraft(userId, customerId, pendingSupersedeRef.current, customerName);
        pendingSupersedeRef.current = [];
        setQuoteId(newId);
        setCreating(false);
      } catch (err: any) {
        toast({
          title: "Failed to create quote",
          description: err?.message || "Please try again.",
          variant: "destructive",
        });
        navigate(mode === "agent" ? "/field" : "/admin/quotes");
      }
    },
    [createDraft, navigate, mode]
  );

  if (needsClient) {
    return (
      <NewQuoteClientPicker
        onPicked={handleClientPicked}
        onCancel={() => navigate(mode === "agent" ? "/field" : "/admin/quotes")}
      />
    );
  }

  if (creating || !quoteId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
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
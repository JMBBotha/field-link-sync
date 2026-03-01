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

  const totalItems = items.filter((i) => !i.parent_item_id).length;
  const totalCost = items.
  filter((i) => !i.parent_item_id).
  reduce((s, i) => s + (i.total_price ?? i.unit_price * i.quantity), 0);

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
            {totalItems} items · {areas.length} zones
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
function UnifiedQuoteBuilderInner() {
  const navigate = useNavigate();
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
      select("id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, is_material_favorite, suggested_consumables, pack_qty, suppliers(name, supplier_type)").
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
        pack_qty: p.pack_qty || null
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

  // Ref to the inline builder's addProduct method
  const areaAddProductRef = useRef<((product: PaletteProduct) => void) | null>(null);

  // Shared PDF product selection state
  const [selectedFromPdf, setSelectedFromPdf] = useState<PdfSelectedProduct[]>([]);
  const [floatingOpen, setFloatingOpen] = useState(false);

  const handleSelectProduct = useCallback((product: Pick<PdfSelectedProduct, "code" | "description" | "price">) => {
    setSelectedFromPdf((prev) => {
      if (prev.some((p) => p.code === product.code)) {
        return prev.filter((p) => p.code !== product.code);
      }
      return [...prev, { ...product, quantity: 1, unitType: "units" }];
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

      <QuoteSharedHeader onBack={() => navigate("/admin/quotes")} />

      {/* Builder mode tabs */}
      















      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "normal" &&
        <div className="h-full flex">
            <div className="flex-1 min-w-0 overflow-y-auto">
              <QuoteBuilderTab
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
                    pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
                  />
                }
              />
            </div>
            <div className="w-[320px] shrink-0 border-l overflow-y-auto p-3 mx-[5px] my-[4px] bg-transparent">
              <QuoteSummaryPanel baskets={baskets} />
            </div>
          </div>
        }
        {activeTab === "visual" &&
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
        {activeTab === "area" &&
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

/* ─── Outer wrapper: creates/loads quote, then mounts provider ─── */
const AdminQuoteBuilderPageUnified = () => {
  const [searchParams] = useSearchParams();
  const [quoteId, setQuoteId] = useState<string | null>(searchParams.get("quoteId"));
  const [creating, setCreating] = useState(!quoteId);
  const navigate = useNavigate();

  // Auto-create a draft quote if no quoteId is provided
  useEffect(() => {
    if (quoteId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) {
          toast({ title: "You must be logged in", variant: "destructive" });
          navigate("/admin/quotes");
          return;
        }

        const { data, error } = await (supabase.from("quotes") as any).
        insert({
          sales_engineer_id: userId,
          status: "draft",
          subtotal: 0,
          vat_rate: 0.15,
          vat_amount: 0,
          total: 0
        }).
        select("id").
        single();

        if (error) throw error;
        if (!cancelled) {
          setQuoteId(data.id);
          setCreating(false);
        }
      } catch (err: any) {
        toast({ title: "Failed to create quote", description: err.message, variant: "destructive" });
        if (!cancelled) navigate("/admin/quotes");
      }
    })();

    return () => {cancelled = true;};
  }, [quoteId, navigate]);

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
      <UnifiedQuoteBuilderInner />
    </QuoteProvider>);

};

export default AdminQuoteBuilderPageUnified;
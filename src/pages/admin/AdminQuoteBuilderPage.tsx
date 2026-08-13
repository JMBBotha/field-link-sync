import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { r2, VAT_RATE, inclVatFromExcl } from "@/lib/pricing";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Wand2, ChevronUp, ChevronDown, ArrowLeft, FileDown, Save,
  Loader2, CheckCircle, PanelRightClose, PanelRightOpen, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { useQuoteBuilderFavorites } from "@/hooks/useQuoteBuilderFavorites";
import ProductPalette from "@/components/catalog/quote-builder/ProductPalette";
import type { PaletteBundle } from "@/components/catalog/quote-builder/ProductPalette";
import VisualCatalogPanel from "@/components/catalog/quote-builder/VisualCatalogPanel";
import BasketCanvas from "@/components/catalog/quote-builder/BasketCanvas";
import DragOverlayCard from "@/components/catalog/quote-builder/DragOverlayCard";
import FloatingDropZoneStrip from "@/components/catalog/quote-builder/FloatingDropZoneStrip";
import ACOptionsModal, { detectACType } from "@/components/catalog/quote-builder/ACOptionsModal";
import QuoteSummaryPanel from "@/components/catalog/quote-builder/QuoteSummaryPanel";
import QuoteBuilderPopup from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import type { WizardTriggerItem } from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import { toast } from "@/hooks/use-toast";
import { useProductUsageStats } from "@/hooks/useProductUsageStats";
import { allTermsMatchBlob } from "@/components/catalog/searchSynonyms";

import { getProductDisplayName } from "@/components/catalog/quote-builder/productDisplayUtils";
import type { PaletteProduct, BasketItem, Basket } from "@/components/catalog/QuoteBuilderTab";
import { computeBundlePricing } from "@/components/catalog/quote-builder/BundleItemsPopover";
import { useUnifiedClients } from "@/hooks/useUnifiedClients";
import logo from "@/assets/logo.png";

// Custom sensor to skip data-no-dnd elements
class NoDndPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        const target = nativeEvent.target as HTMLElement | null;
        if (target?.closest?.('[data-no-dnd="true"]')) return false;
        return true;
      },
    },
  ];
}

/* ─── Right sidebar: Quote Summary ─── */
const QuoteSummaryColumn = ({ baskets, collapsed, onToggle }: {
  baskets: Basket[];
  collapsed: boolean;
  onToggle: () => void;
}) => {
  const { user } = useAuth();
  const [quoteName, setQuoteName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const { data: clients = [] } = useUnifiedClients();

  // ── Pre-fill client from ?fromLead=<leadId> — one-click Lead → Draft Quote ──
  const [searchParams, setSearchParams] = useSearchParams();
  const fromLead = searchParams.get("fromLead") || searchParams.get("leadId");
  useEffect(() => {
    if (!fromLead || selectedClientId || clients.length === 0) return;
    const match = clients.find(
      (c) => c.lead_id === fromLead || c.id === `lead-${fromLead}`,
    );
    if (match) {
      setSelectedClientId(match.customer_id || match.id);
      if (!quoteName) setQuoteName(`Quote for ${match.name}`);
      toast({ title: "Draft quote started", description: `Pre-filled from lead: ${match.name}` });
      // Clean the URL so refresh doesn't re-toast
      searchParams.delete("fromLead");
      searchParams.delete("leadId");
      setSearchParams(searchParams, { replace: true });
    }
  }, [fromLead, clients, selectedClientId, quoteName, searchParams, setSearchParams]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 8);
    const q = clientSearch.toLowerCase();
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [clients, clientSearch]);

  const selectedClient = useMemo(() =>
    selectedClientId ? clients.find(c => c.id === selectedClientId || c.customer_id === selectedClientId) : null
  , [clients, selectedClientId]);

  const summary = useMemo(() => {
    let totalItems = 0, totalQty = 0, grandTotal = 0;
    const zoneBreakdown: { name: string; items: number; qty: number; total: number }[] = [];
    baskets.forEach((b) => {
      let zoneTotal = 0, zoneQty = 0;
      b.items.forEach((i) => {
        if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
          zoneTotal += i.product.price_per_metre * i.length;
        } else {
          zoneTotal += (i.product.selling_price || 0) * i.quantity;
        }
        zoneQty += i.quantity;
      });
      totalItems += b.items.length;
      totalQty += zoneQty;
      grandTotal += zoneTotal;
      if (b.items.length > 0) zoneBreakdown.push({ name: b.name, items: b.items.length, qty: zoneQty, total: zoneTotal });
    });
    return { totalItems, totalQty, grandTotal, zoneBreakdown };
  }, [baskets]);

  const subtotal = r2(summary.grandTotal);
  const vatAmount = r2(summary.grandTotal * VAT_RATE);
  const grandTotalInclVat = r2(subtotal + vatAmount);

  const handleExportPDF = () => {
    toast({ title: "Use the Quote Builder preview to download PDF" });
  };

  const handleSave = async () => {
    if (!selectedClientId) { toast({ title: "Client Required", description: "Please assign a client before saving this quote.", variant: "destructive" }); return; }
    if (!quoteName.trim()) { toast({ title: "Enter a quote name first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const userId = user?.id;
      if (!userId) { toast({ title: "You must be logged in", variant: "destructive" }); setSaving(false); return; }
      const zonesData = baskets.map((b) => ({
        id: b.id, name: b.name,
        items: b.items.map((i) => ({
          productId: i.product.id, productCode: i.product.product_code,
          productName: getProductDisplayName(i.product), quantity: i.quantity,
          length: i.length || null,
          isLengthItem: i.product.sold_in_length && !!i.product.price_per_metre,
          pricePerMetre: i.product.price_per_metre || null,
          unitPrice: i.product.selling_price || i.product.cost_incl_vat || 0,
          category: i.product.product_category,
        })),
      }));
      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const company_id = await getUserCompanyId(user?.id);
      const { data, error } = await (supabase.from("quotes") as any).insert({
        sales_engineer_id: userId, status: "draft",
        subtotal,
        vat_rate: VAT_RATE,
        vat_amount: vatAmount,
        total: grandTotalInclVat,
        ...(selectedClientId ? { customer_id: selectedClientId.startsWith("lead-") ? null : selectedClientId } : {}),
        ...(selectedClient ? { customer_name: selectedClient.name } : {}),
        company_id,
      }).select("id").single();
      if (error) throw error;
      setSavedId(data.id);
      toast({ title: "Quote saved successfully" });
    } catch (err: any) {
      toast({ title: err.message || "Failed to save quote", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (collapsed) return null;

  return (
    <div className="flex flex-col h-full border-l border-white/20">
      <div className="px-4 py-3 border-b border-border/60">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Quote Summary</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {summary.totalItems === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">Add products to zones to see summary</p>
        ) : (
          <>
            {/* Zone breakdown */}
            <div className="space-y-2">
              {summary.zoneBreakdown.map((z) => (
                <div key={z.name} className="rounded-xl border border-border/60 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">{z.name}</span>
                    <span className="text-xs font-bold text-foreground">
                      R{z.total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {z.items} items · {z.qty} qty
                  </p>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="rounded-xl border border-border/60 bg-white p-3 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total items</span>
                <span>{summary.totalItems} ({summary.totalQty} qty)</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal (excl. VAT)</span>
                <span>R{subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>VAT (15%)</span>
                <span>R{vatAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="border-t border-border/60 pt-2 flex justify-between text-sm font-bold text-foreground">
                <span>Grand Total</span>
                <span>R{grandTotalInclVat.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="space-y-2">
          {/* Client selector */}
          <div className="relative">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Client</label>
            {selectedClient ? (
              <div className="flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-2 text-xs">
                <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{selectedClient.name}</span>
                  {selectedClient.phone && <span className="text-[10px] text-muted-foreground">{selectedClient.phone}</span>}
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => { setSelectedClientId(null); setQuoteName(""); setClientSearch(""); }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  ref={clientInputRef}
                  placeholder="Search clients..."
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                  onFocus={() => setShowClientDropdown(true)}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                  className="h-9 text-xs rounded-lg pr-7"
                />
                <Users className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border bg-popover shadow-lg max-h-48 overflow-y-auto">
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedClientId(c.customer_id || c.id);
                          setQuoteName(c.name);
                          setClientSearch("");
                          setShowClientDropdown(false);
                        }}
                      >
                        <p className="text-xs font-medium truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <Input
            placeholder="Quote name..."
            value={quoteName}
            onChange={(e) => setQuoteName(e.target.value)}
            className="h-9 text-xs rounded-lg"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-9 text-xs gap-1.5 rounded-lg" onClick={handleExportPDF}>
              <FileDown className="h-3.5 w-3.5" /> Export PDF
            </Button>
            <Button size="sm" className="flex-1 h-9 text-xs gap-1.5 rounded-lg" onClick={handleSave} disabled={saving || !!savedId || !selectedClientId}
              title={!selectedClientId ? "Assign a client to save this quote" : undefined}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedId ? <CheckCircle className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {savedId ? "Saved" : "Save Quote"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Mobile bottom summary drawer ─── */
const MobileSummaryDrawer = ({ baskets }: { baskets: Basket[] }) => {
  const [expanded, setExpanded] = useState(false);
  const totalItems = baskets.reduce((s, b) => s + b.items.length, 0);
  const totalCost = baskets.reduce(
    (sum, b) => sum + b.items.reduce((s, i) => {
      if (i.product.sold_in_length && i.product.price_per_metre && i.length) return s + i.product.price_per_metre * i.length;
      return s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
    }, 0), 0
  );
  if (totalItems === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="bg-card border-t border-border/60 shadow-2xl rounded-t-2xl">
        <button onClick={() => setExpanded((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-accent/30 transition-colors duration-150">
          <span className="font-semibold text-foreground">
            Quote · {totalItems} items · R{totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </span>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
        </button>
        {expanded && (
          <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
            <QuoteSummaryPanel baskets={baskets} />
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════ */
const AdminQuoteBuilderPage = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLDivElement>(null);
  const { usageMap, trackUsage } = useProductUsageStats();

  const [baskets, setBaskets] = useState<Basket[]>([
    { id: "basket-1", name: "Zone 1", items: [] },
  ]);
  const [activeProduct, setActiveProduct] = useState<PaletteProduct | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [acModalOpen, setAcModalOpen] = useState(false);
  const [acModalProduct, setAcModalProduct] = useState<PaletteProduct | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [visualPanelOpen, setVisualPanelOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTriggerItem, setWizardTriggerItem] = useState<WizardTriggerItem | null>(null);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);

  // ─── Mobile tab state ───
  const [mobileTab, setMobileTab] = useState<"palette" | "canvas">("palette");

  const scrollToCanvas = useCallback(() => {
    if (isMobile) setMobileTab("canvas");
  }, [isMobile]);

  // ─── Shared data hooks ───
  const { products, isLoading } = useQuoteBuilderProducts();
  const { bundles, bundlesLoading } = useQuoteBuilderBundles();
  const { favorites, toggleFavorite } = useQuoteBuilderFavorites(products);

  // ─── Brand & Type Inference ───
  const inferredBrand = useMemo(() => {
    for (const basket of baskets) {
      for (const item of basket.items) {
        if (item.product.product_category === "Air Conditioning" && item.product.brand) return item.product.brand;
      }
    }
    return null;
  }, [baskets]);

  const inferredType = useMemo(() => {
    for (const basket of baskets) {
      for (const item of basket.items) {
        if (item.product.product_category === "Air Conditioning") { const t = detectACType(item.product); if (t) return t; }
      }
    }
    return null;
  }, [baskets]);

  // ─── Filtering ───
  const filteredProducts = useMemo(() => {
    let result = products;
    if (!searchQuery.trim() && categoryFilter !== "all" && categoryFilter !== "favorites") {
      result = result.filter((p) => p.product_category === categoryFilter || (p.category || "").toLowerCase().includes(categoryFilter.toLowerCase()));
    }
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand, p.description, p.category, p.product_category, p.supplier_name].filter(Boolean).join(" ").toLowerCase();
        return allTermsMatchBlob(terms, blob);
      });
    }
    return result;
  }, [products, categoryFilter, searchQuery]);

  // ─── DnD sensors ───
  const sensors = useSensors(
    useSensor(NoDndPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // ─── Basket operations (same logic) ───
  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct) => {
    trackUsage(product.id);
    setBaskets((prev) => prev.map((basket) => {
      if (basket.id !== basketId) return basket;
      const existing = basket.items.find((i) => i.product.id === product.id);
      if (existing) {
        if (product.sold_in_length && product.price_per_metre) {
          return { ...basket, items: basket.items.map((i) => i.product.id === product.id ? { ...i, length: (i.length || 1) + 1 } : i) };
        }
        return { ...basket, items: basket.items.map((i) => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i) };
      }
      const isLengthItem = product.sold_in_length && !!product.price_per_metre;
      return { ...basket, items: [...basket.items, { instanceId: `${product.id}-${Date.now()}`, product, quantity: 1, ...(isLengthItem ? { length: product.unit_length || 1 } : {}) }] };
    }));
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas]);

  const addBundleToBasket = useCallback((basketId: string, bundle: PaletteBundle) => {
    const subItems = bundle.items
      .filter((bItem) => bItem.product)
      .map((bItem) => {
        trackUsage(bItem.product!.id);
        const isLengthItem = bItem.is_length_item && !!bItem.product!.price_per_metre;
        return {
          product: bItem.product as PaletteProduct,
          quantity: bItem.quantity,
          isLengthItem,
          isOptional: bItem.is_optional,
          ...(isLengthItem ? { length: bItem.length_metres || bItem.product!.unit_length || 1 } : {}),
        };
      });

    const { pricingType, unitPrice, unitCost } = computeBundlePricing(subItems);

    const firstProduct = subItems.find((i) => !i.isOptional)?.product || subItems[0]?.product;
    if (!firstProduct) return;

    const bundleItem: BasketItem = {
      instanceId: `bundle-${bundle.id}-${Date.now()}`,
      product: {
        ...firstProduct,
        short_name: bundle.name,
        description: `Bundle: ${bundle.name} (${subItems.length} items)`,
        product_code: `BUNDLE-${bundle.id.slice(0, 6).toUpperCase()}`,
        product_category: firstProduct.product_category,
        selling_price: unitPrice,
        cost_excl_vat: unitCost,
        cost_incl_vat: inclVatFromExcl(unitCost),
        sold_in_length: pricingType === "p/meter",
        price_per_metre: pricingType === "p/meter" ? unitPrice : null,
      },
      quantity: 1,
      ...(pricingType === "p/meter" ? { length: 1 } : {}),
      isBundle: true,
      bundleId: bundle.id,
      bundleName: bundle.name,
      bundleItems: subItems,
      bundlePricingType: pricingType,
      bundleUnitPrice: unitPrice,
      bundleUnitCost: unitCost,
    };

    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== basketId) return basket;
        return { ...basket, items: [...basket.items, bundleItem] };
      })
    );
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const product = (event.active.data.current as any)?.product as PaletteProduct | undefined;
    if (product) setActiveProduct(product);
    setIsDragging(true);
  }, []);
  const handleDragCancel = useCallback(() => { setActiveProduct(null); setIsDragging(false); }, []);
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveProduct(null); setIsDragging(false);
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    let targetBasket: Basket | null = null;
    for (const basket of baskets) { if (basket.id === overId) { targetBasket = basket; break; } }
    if (!targetBasket) return;
    const bundleData = (active.data.current as any)?.bundle;
    if (bundleData) { addBundleToBasket(targetBasket.id, bundleData); toast({ title: `Added bundle "${bundleData.name}" to ${targetBasket.name}` }); return; }
    const product = (active.data.current as any)?.product as PaletteProduct | undefined;
    if (!product) return;
    addProductToBasket(targetBasket.id, product);
    toast({ title: `Added ${product.short_name || product.product_code} to ${targetBasket.name}` });
  }, [baskets, addProductToBasket, addBundleToBasket]);

  const handleRemoveItem = useCallback((basketId: string, instanceId: string) => {
    setBaskets((prev) => prev.map((b) => b.id === basketId ? { ...b, items: b.items.filter((i) => i.instanceId !== instanceId) } : b));
  }, []);
  const handleUpdateQuantity = useCallback((basketId: string, instanceId: string, qty: number) => {
    if (qty < 1) return;
    setBaskets((prev) => prev.map((b) => b.id === basketId ? { ...b, items: b.items.map((i) => i.instanceId === instanceId ? { ...i, quantity: qty } : i) } : b));
  }, []);
  const handleUpdateLength = useCallback((basketId: string, instanceId: string, length: number) => {
    if (length < 0.1) return;
    setBaskets((prev) => prev.map((b) => b.id === basketId ? { ...b, items: b.items.map((i) => i.instanceId === instanceId ? { ...i, length } : i) } : b));
  }, []);
  const handleAddBasket = useCallback(() => {
    const id = `basket-${Date.now()}`;
    setBaskets((prev) => [...prev, { id, name: `Zone ${prev.length + 1}`, items: [] }]);
  }, []);
  const handleRenameBasket = useCallback((basketId: string, newName: string) => {
    setBaskets((prev) => prev.map((b) => (b.id === basketId ? { ...b, name: newName } : b)));
  }, []);
  const handleRemoveBasket = useCallback((basketId: string) => {
    setBaskets((prev) => prev.filter((b) => b.id !== basketId));
  }, []);
  const handleDuplicateBasket = useCallback((basketId: string) => {
    setBaskets((prev) => {
      const source = prev.find((b) => b.id === basketId);
      if (!source) return prev;
      const newId = `basket-${Date.now()}`;
      const duplicate: Basket = { id: newId, name: `${source.name} (copy)`, items: source.items.map((i) => ({ ...i, instanceId: `${i.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })) };
      const idx = prev.indexOf(source);
      const next = [...prev];
      next.splice(idx + 1, 0, duplicate);
      return next;
    });
  }, []);
  const handleApplyTemplate = useCallback((zoneNames: string[]) => {
    setBaskets(zoneNames.map((name, i) => ({ id: `basket-${Date.now()}-${i}`, name, items: [] as BasketItem[] })));
  }, []);
  const handleACConfirm = useCallback((product: PaletteProduct) => {
    const targetBasket = baskets[0];
    if (targetBasket) addProductToBasket(targetBasket.id, product);
  }, [baskets, addProductToBasket]);
  const handleClearAll = useCallback(() => setBaskets([]), []);
  const handleWizardSave = useCallback((newBaskets: Basket[]) => {
    setBaskets((prev) => [...prev, ...newBaskets]);
    toast({ title: `Added ${newBaskets.length} zones from Area Quote Builder` });
  }, []);

  // PDF search ref – allows wizard to trigger scroll-to-product in the Visual Catalog
  const pdfSearchRef = useRef<((term: string) => void) | null>(null);

  const handleOpenWizardFromPdf = useCallback((item: WizardTriggerItem) => {
    setWizardTriggerItem(item);
    // Keep Visual Catalog open – wizard renders on top at z-[60]
    setWizardOpen(true);
  }, []);

  // ─── Totals ───
  const totalCost = useMemo(() => baskets.reduce((sum, b) => sum + b.items.reduce((s, i) => {
    if (i.product.sold_in_length && i.product.price_per_metre && i.length) return s + i.product.price_per_metre * i.length;
    return s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
  }, 0), 0), [baskets]);
  const totalItems = baskets.reduce((s, b) => s + b.items.reduce((qs, i) => qs + i.quantity, 0), 0);

  /* ═══ RENDER ═══ */
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "linear-gradient(135deg, #1e6bb8 0%, #d0d0d0 100%)", backgroundAttachment: "fixed" }}>
      {/* ─── HEADER ─── */}
      <header className="shrink-0 h-14 flex items-center justify-between px-4 shadow-sm" style={{ backgroundColor: "#0077B6" }}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/quotes")}
            className="h-9 w-9 rounded-xl text-white hover:bg-white/10 transition-all duration-150">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img src={logo} alt="Logo" style={{ height: "41px" }} />
          <div className="hidden sm:block h-6 w-px bg-white/20" />
          <h1 className="hidden sm:block text-lg font-semibold tracking-tight text-white">Quote Builder</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5">
            <span className="text-xs text-white/70">{totalItems} items · {baskets.length} zones</span>
            <span className="text-sm font-bold text-white ml-1">
              R{totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 rounded-xl h-9 text-xs hidden sm:flex text-white hover:bg-white/10" onClick={() => setWizardOpen(true)}>
            <Wand2 className="h-3.5 w-3.5" /> Area Quote
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hidden md:flex text-white hover:bg-white/10"
            onClick={() => setSummaryCollapsed((c) => !c)}
            title={summaryCollapsed ? "Show summary" : "Hide summary"}>
            {summaryCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* ─── MOBILE TABS ─── */}
      {isMobile && (
        <div className="shrink-0 flex border-b border-border/60 bg-card">
          <button onClick={() => setMobileTab("palette")}
            className={`flex-1 py-2.5 text-xs font-semibold text-center transition-colors duration-150 ${mobileTab === "palette" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}>
            Products
          </button>
          <button onClick={() => setMobileTab("canvas")}
            className={`flex-1 py-2.5 text-xs font-semibold text-center transition-colors duration-150 ${mobileTab === "canvas" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}>
            Build Area Quote
          </button>
        </div>
      )}

      {/* ─── MAIN CONTENT ─── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* LEFT: Product Palette */}
          <div className={`${isMobile ? (mobileTab === "palette" ? "flex" : "hidden") : "flex"} flex-col w-full md:w-80 lg:w-96 shrink-0 border-r border-white/20 min-h-0 overflow-hidden p-1`}>
            <ProductPalette
              products={filteredProducts}
              isLoading={isLoading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              isDragging={isDragging}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              usageMap={usageMap}
              bundles={bundles}
              bundlesLoading={bundlesLoading}
              baskets={baskets}
              onAddProductToBasket={addProductToBasket}
              onOpenVisualPanel={() => setVisualPanelOpen(true)}
            />
          </div>

          {/* CENTER: Build Area Quote */}
          <div ref={canvasRef}
            className={`${isMobile ? (mobileTab === "canvas" ? "flex" : "hidden") : "flex"} flex-col flex-1 min-h-0 min-w-0 overflow-hidden p-1`}>
            <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ scrollBehavior: "smooth" }}>
              <BasketCanvas
                baskets={baskets}
                allProducts={products}
                onAddBasket={handleAddBasket}
                onRenameBasket={handleRenameBasket}
                onRemoveBasket={handleRemoveBasket}
                onRemoveItem={handleRemoveItem}
                onUpdateQuantity={handleUpdateQuantity}
                onAddProductToBasket={addProductToBasket}
                onDuplicateBasket={handleDuplicateBasket}
                onApplyTemplate={handleApplyTemplate}
                onClearAll={handleClearAll}
                onUpdateLength={handleUpdateLength}
                isDragging={isDragging}
                isCompact={visualPanelOpen}
              />
            </div>
          </div>

          {/* RIGHT: Summary panel (desktop only) */}
          {!isMobile && (
            <div className={`transition-all duration-200 ease-in-out overflow-hidden ${summaryCollapsed ? "w-0" : "w-72 lg:w-80"}`}>
              <QuoteSummaryColumn baskets={baskets} collapsed={summaryCollapsed} onToggle={() => setSummaryCollapsed((c) => !c)} />
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeProduct ? <DragOverlayCard product={activeProduct} /> : null}
        </DragOverlay>
        <FloatingDropZoneStrip baskets={baskets} visible={isDragging && visualPanelOpen} />
        <VisualCatalogPanel
          open={visualPanelOpen} onClose={() => setVisualPanelOpen(false)}
          baskets={baskets} onAddProductToBasket={addProductToBasket}
          onAddBasket={handleAddBasket} onRemoveBasket={handleRemoveBasket}
          products={products} isDragging={isDragging}
          onOpenWizard={handleOpenWizardFromPdf}
          pdfSearchRef={pdfSearchRef}
          wizardOpen={wizardOpen}
        />
      </DndContext>

      {/* Mobile bottom summary */}
      {isMobile && <MobileSummaryDrawer baskets={baskets} />}

      {/* Modals */}
      <ACOptionsModal open={acModalOpen} onClose={() => setAcModalOpen(false)} products={products}
        initialProduct={acModalProduct} onConfirm={handleACConfirm} inferredBrand={inferredBrand} inferredType={inferredType} />
      <QuoteBuilderPopup open={wizardOpen} onClose={() => { setWizardOpen(false); setWizardTriggerItem(null); }} products={products}
        bundles={bundles} onSave={handleWizardSave} triggerItem={wizardTriggerItem}
        onPdfSearch={(term) => pdfSearchRef.current?.(term)} />
    </div>
  );
};

export default AdminQuoteBuilderPage;

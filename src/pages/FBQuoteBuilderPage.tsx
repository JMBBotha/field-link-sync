import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfSelectedProduct } from "@/types/pdfSelection";
import { r2, VAT_RATE } from "@/lib/pricing";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Wand2, ChevronUp, ChevronDown, ArrowLeft, FileDown, Save,
  Loader2, CheckCircle, PanelRightClose, PanelRightOpen, QrCode, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { pushRecentProduct } from "@/components/catalog/quote-builder/ProductPalette";
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
import { extractBtu } from "@/lib/bundles";

import { getProductDisplayName } from "@/components/catalog/quote-builder/productDisplayUtils";
import type { PaletteProduct, BasketItem, Basket } from "@/components/catalog/QuoteBuilderTab";
import { computeBundlePricing } from "@/components/catalog/quote-builder/BundleItemsPopover";
import { useCompany } from "@/providers/CompanyProvider";
import logo from "@/assets/logo.png";
import PanelErrorBoundary from "@/components/shared/PanelErrorBoundary";
import FloatingSelectedItems from "@/components/catalog/quote-builder/FloatingSelectedItems";

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
  const [searchParams] = useSearchParams();
  const prefillLeadId = searchParams.get("leadId");
  const prefillCustomerId = searchParams.get("customerId");
  const prefillLocationId = searchParams.get("locationId");
  const prefillQuoteName = searchParams.get("quoteName") || "";
  const [quoteName, setQuoteName] = useState(prefillQuoteName);
  const [locationId, setLocationId] = useState<string | null>(prefillLocationId || null);
  const [locations, setLocations] = useState<Array<{ id: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  // Load customer locations for picker
  useEffect(() => {
    if (!prefillCustomerId) { setLocations([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from("customer_locations") as any)
        .select("id, label, address_line1, city")
        .eq("customer_id", prefillCustomerId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const rows = ((data as any[]) || []).map((r) => ({
        id: r.id,
        label: r.label || [r.address_line1, r.city].filter(Boolean).join(", ") || "Location",
      }));
      setLocations(rows);
      // Default to first location if nothing picked yet
      if (!locationId && rows.length > 0) setLocationId(rows[0].id);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCustomerId]);

  // PDF selection state for Visual Catalog checkboxes
  const [selectedFromPdf, setSelectedFromPdf] = useState<PdfSelectedProduct[]>([]);

  const handleSelectProduct = useCallback((product: Pick<PdfSelectedProduct, "code" | "description" | "price"> & Partial<Pick<PdfSelectedProduct, "costPrice" | "markupPercent">>) => {
    setSelectedFromPdf((prev) => {
      if (prev.some((p) => p.code === product.code)) {
        return prev.filter((p) => p.code !== product.code);
      }
      return [...prev, { ...product, quantity: 1, unitType: "units", costPrice: product.costPrice, markupPercent: product.markupPercent }];
    });
  }, []);

  const updateSelectedItem = useCallback((code: string, updates: Partial<Pick<PdfSelectedProduct, "quantity" | "unitType" | "costPrice" | "markupPercent" | "price">>) => {
    setSelectedFromPdf((prev) =>
      prev.map((item) => (item.code === code ? { ...item, ...updates } : item))
    );
  }, []);

  const summary = useMemo(() => {
    let totalItems = 0, totalQty = 0, grandTotal = 0;
    const zoneBreakdown: { name: string; items: number; qty: number; total: number }[] = [];
    baskets.forEach((b) => {
      let zoneTotal = 0, zoneQty = 0;
      b.items.forEach((i) => {
        if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
          zoneTotal += i.product.price_per_metre * i.length;
        } else {
          zoneTotal += (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
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
        total: grandTotalInclVat, notes: quoteName, visual_sections: zonesData,
        company_id,
        lead_id: prefillLeadId || null,
        customer_id: prefillCustomerId || null,
        location_id: locationId || null,
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
            <div className="space-y-2">
              {summary.zoneBreakdown.map((z) => (
                <div key={z.name} className="rounded-xl border border-border/60 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">{z.name}</span>
                    <span className="text-xs font-bold text-foreground">
                      R{z.total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{z.items} items · {z.qty} qty</p>
                </div>
              ))}
            </div>
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
        <div className="space-y-2">
          {prefillCustomerId && locations.length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Location
              </label>
              <Select value={locationId || ""} onValueChange={(v) => setLocationId(v)}>
                <SelectTrigger className="h-9 text-xs rounded-lg">
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
            <Button size="sm" className="flex-1 h-9 text-xs gap-1.5 rounded-lg" onClick={handleSave} disabled={saving || !!savedId}>
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
   CLIENT PORTAL QUOTE BUILDER PAGE
   ═══════════════════════════════════════════════════════════════ */
export type QuoteBuilderMode = "admin" | "agent" | "client";

const FBQuoteBuilderPage = ({ mode = "client" }: { mode?: QuoteBuilderMode }) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLDivElement>(null);
  const { usageMap, trackUsage } = useProductUsageStats();
  // Always call the hook (Rules of Hooks) — returns safe defaults when no provider
  const { company, companyId } = useCompany();

  const backPath = mode === "agent" ? "/field" : mode === "admin" ? "/admin" : `/client/${companyId}/dashboard`;

  const DRAFT_KEY = "quote-builder-draft";
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveredDraft, setRecoveredDraft] = useState<{ baskets: Basket[]; selectedFromPdf: PdfSelectedProduct[] } | null>(null);

  const [baskets, setBaskets] = useState<Basket[]>(() => {
    return [{ id: "basket-1", name: "Zone 1", items: [] }];
  });

  // PDF selection state (shared with Visual Catalog and Product Palette)
  const [selectedFromPdf, setSelectedFromPdf] = useState<PdfSelectedProduct[]>([]);

  const handleSelectProduct = useCallback((product: Pick<PdfSelectedProduct, "code" | "description" | "price"> & Partial<Pick<PdfSelectedProduct, "costPrice" | "markupPercent">>) => {
    setSelectedFromPdf((prev) => {
      if (prev.some((p) => p.code === product.code)) return prev.filter((p) => p.code !== product.code);
      return [...prev, { ...product, quantity: 1, unitType: "units", costPrice: product.costPrice, markupPercent: product.markupPercent }];
    });
  }, []);

  const updateSelectedItem = useCallback((code: string, updates: Partial<Pick<PdfSelectedProduct, "quantity" | "unitType" | "costPrice" | "markupPercent" | "price">>) => {
    setSelectedFromPdf((prev) => prev.map((item) => (item.code === code ? { ...item, ...updates } : item)));
  }, []);

  const persistDraft = useCallback(() => {
    const hasBasketItems = baskets.some((basket) => basket.items.length > 0);
    const hasSelectedPdfItems = selectedFromPdf.length > 0;

    if (!hasBasketItems && !hasSelectedPdfItems) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }

    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 1,
        baskets,
        selectedFromPdf,
      })
    );
  }, [baskets, selectedFromPdf]);

  // Draft recovery on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const draft = Array.isArray(parsed)
        ? { baskets: parsed as Basket[], selectedFromPdf: [] as PdfSelectedProduct[] }
        : {
            baskets: Array.isArray(parsed?.baskets) ? (parsed.baskets as Basket[]) : [],
            selectedFromPdf: Array.isArray(parsed?.selectedFromPdf) ? (parsed.selectedFromPdf as PdfSelectedProduct[]) : [],
          };

      const hasBasketItems = draft.baskets.some((basket) => basket.items?.length > 0);
      const hasSelectedPdfItems = draft.selectedFromPdf.length > 0;

      if (hasBasketItems || hasSelectedPdfItems) {
        setRecoveredDraft(draft);
        setShowRecovery(true);
      }
    } catch {
      /* ignore corrupt data */
    }
  }, []);

  // Auto-save every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      persistDraft();
    }, 30000);
    return () => clearInterval(interval);
  }, [persistDraft]);

  // Save on key mutations
  useEffect(() => {
    persistDraft();
  }, [persistDraft]);

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
  const [mobileTab, setMobileTab] = useState<"palette" | "canvas">("palette");
  const [floatingPanelOpen, setFloatingPanelOpen] = useState(false);

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

  const sensors = useSensors(
    useSensor(NoDndPointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const isAirConditioningProduct = useCallback((product: PaletteProduct) => {
    const blob = [product.product_category, product.category, product.short_name, product.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes("air conditioning") || blob.includes("aircon");
  }, []);

  type QuoteBuilderBundle = PaletteBundle & { min_btu?: number | null; max_btu?: number | null };

  const findPipingBundleForBtu = useCallback((btu: number | null): QuoteBuilderBundle | null => {
    if (!btu || btu <= 0) return null;
    const pipingBundles = (bundles as QuoteBuilderBundle[]).filter((bundle) => {
      const text = [bundle.name, bundle.description].filter(Boolean).join(" ").toUpperCase();
      return text.includes("PIPING");
    });

    const rangeMatch = pipingBundles.find((bundle) => {
      if (bundle.min_btu == null || bundle.max_btu == null) return false;
      return btu >= bundle.min_btu && btu <= bundle.max_btu;
    });
    if (rangeMatch) return rangeMatch;

    const kSize = Math.round(btu / 1000);
    const paddedK = String(kSize).padStart(2, "0");
    const btuRegex = new RegExp(`\\b(?:${kSize}K|${paddedK}K)\\b`, "i");

    return pipingBundles.find((bundle) => btuRegex.test([bundle.name, bundle.description].filter(Boolean).join(" "))) || null;
  }, [bundles]);

  const buildBundleBasketItem = useCallback((bundle: PaletteBundle): BasketItem | null => {
    const subItems = bundle.items
      .filter((bItem) => bItem.product)
      .map((bItem) => {
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
    if (!firstProduct) return null;

    return {
      instanceId: `bundle-${bundle.id}-${Date.now()}`,
      product: {
        ...firstProduct,
        short_name: bundle.name,
        description: `Bundle: ${bundle.name} (${subItems.length} items)`,
        product_code: `BUNDLE-${bundle.id.slice(0, 6).toUpperCase()}`,
        product_category: firstProduct.product_category,
        selling_price: unitPrice,
        cost_excl_vat: unitCost,
        cost_incl_vat: unitCost * 1.15,
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
  }, []);

  // ─── Basket operations ───
  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct) => {
    trackUsage(product.id);
    pushRecentProduct(product.id);

    const isAC = isAirConditioningProduct(product);
    const parsedBtu = isAC ? extractBtu(product) : null;
    const autoBundle = isAC ? findPipingBundleForBtu(parsedBtu) : null;

    toast({ title: `[DEBUG] isAC=${isAC}, parsedBtu=${parsedBtu ?? "null"}, bundlesCount=${bundles?.length ?? 0}` });
    if (autoBundle) {
      toast({ title: `[DEBUG] Found bundle: ${autoBundle.name}` });
      autoBundle.items.forEach((item) => {
        if (item.product?.id) trackUsage(item.product.id);
      });
    } else {
      toast({ title: "[DEBUG] No matching bundle found" });
    }

    setBaskets((prev) => prev.map((basket) => {
      if (basket.id !== basketId) return basket;
      const nextItems = [...basket.items];
      const existingIndex = nextItems.findIndex((i) => !i.isBundle && i.product.id === product.id);
      const isLengthItem = product.sold_in_length && !!product.price_per_metre;

      if (existingIndex >= 0) {
        const existing = nextItems[existingIndex];
        nextItems[existingIndex] = isLengthItem
          ? { ...existing, length: (existing.length || 1) + 1 }
          : { ...existing, quantity: existing.quantity + 1 };
      } else {
        nextItems.push({
          instanceId: `${product.id}-${Date.now()}`,
          product,
          quantity: 1,
          ...(isLengthItem ? { length: product.unit_length || 1 } : {}),
        });
      }

      if (autoBundle) {
        const existingBundleIndex = nextItems.findIndex((i) => i.isBundle && i.bundleId === autoBundle.id);
        if (existingBundleIndex >= 0) {
          const existingBundle = nextItems[existingBundleIndex];
          nextItems[existingBundleIndex] = existingBundle.bundlePricingType === "p/meter"
            ? { ...existingBundle, length: (existingBundle.length || 1) + 1 }
            : { ...existingBundle, quantity: existingBundle.quantity + 1 };
        } else {
          const bundleBasketItem = buildBundleBasketItem(autoBundle);
          if (bundleBasketItem) nextItems.push(bundleBasketItem);
        }
      }

      return { ...basket, items: nextItems };
    }));
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas, isAirConditioningProduct, findPipingBundleForBtu, bundles, buildBundleBasketItem]);

  const addBundleToBasket = useCallback((basketId: string, bundle: PaletteBundle) => {
    bundle.items.forEach((item) => {
      if (item.product?.id) trackUsage(item.product.id);
    });

    const bundleItem = buildBundleBasketItem(bundle);
    if (!bundleItem) return;

    setBaskets((prev) =>
      prev.map((basket) => {
        if (basket.id !== basketId) return basket;
        return { ...basket, items: [...basket.items, bundleItem] };
      })
    );
    scrollToCanvas();
  }, [trackUsage, scrollToCanvas, buildBundleBasketItem]);

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

  const pdfSearchRef = useRef<((term: string) => void) | null>(null);
  const handleOpenWizardFromPdf = useCallback((item: WizardTriggerItem) => {
    setWizardTriggerItem(item);
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
      {/* ─── CLIENT PORTAL HEADER ─── */}
      <header className="shrink-0 h-14 flex items-center justify-between px-4 bg-primary text-primary-foreground shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(backPath)}
            className="h-9 w-9 rounded-xl text-primary-foreground hover:bg-primary-foreground/10 transition-all duration-150">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img src={logo} alt="Logo" style={{ height: "41px" }} />
          <div className="hidden sm:block h-6 w-px bg-primary-foreground/20" />
          <h1 className="hidden sm:block text-lg font-semibold tracking-tight text-primary-foreground">Quote Builder</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 rounded-xl bg-primary-foreground/10 px-3 py-1.5">
            <span className="text-xs text-primary-foreground/70">{totalItems} items · {baskets.length} zones</span>
            <span className="text-sm font-bold text-primary-foreground ml-1">
              R{totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 rounded-xl h-9 text-xs hidden sm:flex text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setWizardOpen(true)}>
            <Wand2 className="h-3.5 w-3.5" /> Area Quote
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-primary-foreground hover:bg-primary-foreground/10">
            <QrCode className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hidden md:flex text-primary-foreground hover:bg-primary-foreground/10"
            onClick={() => setSummaryCollapsed((c) => !c)}
            title={summaryCollapsed ? "Show summary" : "Hide summary"}>
            {summaryCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Gold accent line */}
      <div className="h-[3px] bg-[hsl(40,96%,53%)] shrink-0" />

      {/* Draft recovery banner */}
      {showRecovery && recoveredDraft && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30">
          <p className="text-xs font-medium text-foreground">
            Recover last unsaved quote? ({recoveredDraft.baskets.reduce((sum, basket) => sum + basket.items.length, 0)} items in {recoveredDraft.baskets.length} zones · {recoveredDraft.selectedFromPdf.length} selected from PDF)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setShowRecovery(false);
                localStorage.removeItem(DRAFT_KEY);
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setBaskets(recoveredDraft.baskets);
                setSelectedFromPdf(recoveredDraft.selectedFromPdf);
                setShowRecovery(false);
                toast({ title: "Quote and selected items recovered" });
              }}
            >
              Recover
            </Button>
          </div>
        </div>
      )}

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
              pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
              onPopOutSelected={() => setFloatingPanelOpen(true)}
            />
          </div>

          {/* CENTER: Build Area Quote */}
          <div ref={canvasRef}
            className={`${isMobile ? (mobileTab === "canvas" ? "flex" : "hidden") : "flex"} flex-col flex-1 min-h-0 min-w-0 overflow-hidden p-1`}>
            <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ scrollBehavior: "smooth" }}>
              <PanelErrorBoundary panelName="Build Area Quote">
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
              </PanelErrorBoundary>
            </div>
          </div>

          {/* RIGHT: Summary panel (desktop only) */}
          {!isMobile && (
            <div className={`transition-all duration-200 ease-in-out overflow-hidden ${summaryCollapsed ? "w-0" : "w-72 lg:w-80"}`}>
              <PanelErrorBoundary panelName="Quote Summary">
                <QuoteSummaryColumn baskets={baskets} collapsed={summaryCollapsed} onToggle={() => setSummaryCollapsed((c) => !c)} />
              </PanelErrorBoundary>
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeProduct ? <DragOverlayCard product={activeProduct} /> : null}
        </DragOverlay>
        <FloatingDropZoneStrip baskets={baskets} visible={isDragging && visualPanelOpen} />
        <PanelErrorBoundary panelName="Visual Catalog">
          <VisualCatalogPanel
            open={visualPanelOpen} onClose={() => setVisualPanelOpen(false)}
            baskets={baskets} onAddProductToBasket={addProductToBasket}
            onAddBasket={handleAddBasket} onRemoveBasket={handleRemoveBasket}
            products={products} isDragging={isDragging}
            onOpenWizard={handleOpenWizardFromPdf}
            pdfSearchRef={pdfSearchRef}
            wizardOpen={wizardOpen}
            pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
          />
        </PanelErrorBoundary>
      </DndContext>

      {/* Floating Selected Items panel */}
      {floatingPanelOpen && (
        <FloatingSelectedItems
          pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }}
          onClose={() => setFloatingPanelOpen(false)}
        />
      )}

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

export default FBQuoteBuilderPage;

import { readPdfBasket, writePdfBasket, migrateDraftPdfBasket, pdfBasketKey } from "@/lib/pdfBasketStore";
import { liveProducts } from "@/lib/liveProducts";
import { resolveBundlesLive } from "@/lib/bundleResolve";
import { basketInstallFrom } from "@/lib/installTemplates";
import QuoteBuilderLayout from "@/components/quoting/QuoteBuilderLayout";
import PricingChecksRow from "@/components/quoting/PricingChecksRow";
import { useMarginView } from "@/hooks/useMarginView";
import { resolveProductMarkupPercent, classifyQuoteCategory } from "@/lib/pricing";
import { canMergeRepick, freshProduct, standardSell } from "@/lib/priceGuard";
/**
 * Unified Quote Builder Page — wraps Normal / Visual / Area builders
 * in a shared header with tabs. Each tab renders the real builder component.
 */

import { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore, type MutableRefObject } from "react";
import type { PdfSelectedProduct } from "@/types/pdfSelection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users, X, Loader2, Mic, ChevronDown, ChevronRight, Maximize2, Minimize2, Send } from "lucide-react";
import { useIsTabletOrBelow } from "@/hooks/use-mobile";
import { formatRand } from "@/utils/formatRand";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import PaymentPlanPicker from "@/components/quoting/PaymentPlanPicker";
import QuoteRecordStrip from "@/components/quoting/QuoteRecordStrip";
import { openMandyQuoteMode } from "@/lib/mandy/registry";
import { allTermsMatchBlob } from "@/components/catalog/searchSynonyms";
import { useProductUsageStats } from "@/hooks/useProductUsageStats";
import ProductPalette from "@/components/catalog/quote-builder/ProductPalette";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

import { supabase } from "@/integrations/supabase/client";
import { QuoteProvider, useQuoteContext, trackQuoteWrite } from "@/contexts/QuoteContext";
import MandyQuoteActions from "@/components/mandy/MandyQuoteActions";
import LabourPanel from "@/components/quoting/LabourPanel";
import { isLabourItem } from "@/lib/labour";
import { basketsToQuoteState } from "@/utils/quoteBasketTotals";
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
import { buildAreaReview } from "@/utils/areaReviewTotals";
import { computeBasketsQuoteTotals } from "@/utils/quoteBasketTotals";
import { subscribeQuoteMarkupRates, getQuoteMarkupRatesSnapshot } from "@/lib/pricing";
import { pdfItemToPaletteProduct } from "@/utils/pdfItemToProduct";
import { persistQuoteFromBaskets, fetchQuoteLineStamp, fetchStampForIds, QuoteChangedElsewhereError, waitForBuilderSaves, type PersistQuoteResult } from "@/utils/persistQuoteFromBaskets";
import { mergeStamps, stampChanged, type QuoteLineStamp } from "@/lib/quoteLineStamp";
import { useQuoteEditors } from "@/hooks/useQuoteEditors";
import { stubProductFromQuoteItem } from "@/utils/hydrateQuoteItem";
import { kitBasketFields, kitFromSavedItem, collapseExplodedKits } from "@/components/catalog/quote-builder/kitLine";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { ensureQuoteReadyToSend } from "@/lib/quoteSend";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";
import { useUnsavedQuoteGuard } from "@/hooks/useUnsavedQuoteGuard";
import { missingLabourFor, normalizeLabourMode, reconcileAutoLabour } from "@/lib/areaLabour";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useQuoteFavourites } from "@/hooks/useQuoteFavourites";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useInstallTemplates } from "@/hooks/useInstallTemplates";
import FavouritesPicker from "@/components/quoting/FavouritesPicker";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isAirConditioningProduct, planStandardInstall } from "@/lib/mandy/quoteOps";
import { fetchVisualCatalogAllowlist, filterPaletteCatalog } from "@/lib/catalogSoT";
import { useActiveSpecials } from "@/hooks/useActiveSpecials";
import QuoteActionBar from "@/components/quoting/QuoteActionBar";
import { useQuoteDocumentActions } from "@/hooks/useQuoteDocumentActions";
import AreaFirstBuilder from "@/components/quoting/AreaFirstBuilder";
import { useSpecialPrompt } from "@/components/specials/SpecialsUi";
import { specialLineMeta } from "@/lib/specials";


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

  const dbTotals = useMemo(() => computeQuoteTotals(items, areas, undefined, { type: meta?.discount_type, value: meta?.discount_value }), [items, areas, meta?.discount_type, meta?.discount_value]);

  // Prefer live in-progress builder totals so header reflects unsaved edits
  // BEFORE they hit the DB. Falls back to persisted totals when idle.
  const totalItems = live.hasLiveData ? live.items : dbTotals.itemCount;
  const zoneCount = live.hasLiveData ? live.zones : dbTotals.zoneCount;
  // Headline is TOTAL INCL. VAT (same maths as the estimate page and quotes.total).
  const totalAmount = live.hasLiveData ? live.total : dbTotals.total;


  return (
    <header className="shrink-0 h-11 flex items-center justify-between px-2 sm:px-3 shadow-sm" style={{ backgroundColor: "#0077B6" }}>
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

        <div className="flex items-center gap-1.5 rounded-xl bg-white/10 px-2.5 sm:px-3 py-1.5">
          <span className="hidden sm:inline text-xs text-white/70">
            {totalItems} items · {zoneCount} zones ·
          </span>
          <span className="text-xs sm:text-sm font-bold text-white sm:ml-1">
            {formatRand(totalAmount)}
          </span>
          <span className="text-[10px] text-white/60">incl. VAT</span>
        </div>

        {meta?.quote_number ?
        <span className="hidden lg:block text-[10px] text-white/50 font-mono">{meta.quote_number}</span> :
        clientLabel ?
        <span className="hidden lg:block text-[10px] text-white/50 font-mono">Draft – creating…</span> : null
        }
      </div>
    </header>);

}

/* ─── Mandy quote actions on the full builder (same handlers as the estimate page) ─── */
interface MandyBridge { beforeWrite: () => Promise<string | null>; prepareRemount: () => void }
function BuilderMandyActions({ bridgeRef, onRemount }: { bridgeRef: MutableRefObject<MandyBridge | null>; onRemount: () => void }) {
  const navigate = useNavigate();
  const { quoteId, meta } = useQuoteContext();
  if (!quoteId) return null;
  return (
    <MandyQuoteActions
      vatRate={Number((meta as any)?.vat_rate) || 0.15}
      beforeWrite={async () => (bridgeRef.current ? bridgeRef.current.beforeWrite() : null)}
      afterRefresh={() => { bridgeRef.current?.prepareRemount(); onRemount(); }}
      onPdf={async () => {
        // One builder (Johan 09:49): the PDF runs right here (Inner picks up ?mandy=pdf).
        navigate(`/admin/quote-builder?quoteId=${quoteId}&mandy=pdf`, { replace: true });
        return `Building the PDF for ${meta?.quote_number || "the quote"} — the download starts in a moment.`;
      }}
    />
  );
}

/* ─── Inner content (needs context) ─── */
function UnifiedQuoteBuilderInner({ mode = "admin", bridgeRef, tabRef, onRemount }: { mode?: QuoteBuilderMode; bridgeRef?: MutableRefObject<MandyBridge | null>; tabRef?: MutableRefObject<string | null>; onRemount?: () => void }) {
  const navigate = useNavigate();
  const { items: ctxItems, areas: ctxAreas, loading: ctxLoading, quoteId, meta, addItem: ctxAddItem, addArea: ctxAddArea, refetch: ctxRefetch } = useQuoteContext();
  // Two-editor guard: presence pauses saving; the line stamp blocks writes over outside changes.
  const { others: otherEditors } = useQuoteEditors(quoteId, "builder");
  const othersRef = useRef(otherEditors);
  othersRef.current = otherEditors;
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const changedElsewhereRef = useRef(false);
  const baselineStampRef = useRef<QuoteLineStamp | null>(null);
  const stampLoadedRef = useRef(false);
  useEffect(() => {
    if (ctxLoading || !quoteId || stampLoadedRef.current) return;
    stampLoadedRef.current = true;
    fetchQuoteLineStamp(quoteId).then((st) => { baselineStampRef.current = st; }).catch((e) => console.error("[QuoteBuilder] stamp load failed", e));
  }, [ctxLoading, quoteId]);
  const guardedPersist = useCallback(async (qid: string, bk: Basket[], ids: Set<string>): Promise<PersistQuoteResult> => {
    try {
      const res = await persistQuoteFromBaskets(qid, bk, ids, { baseline: () => baselineStampRef.current });
      try { baselineStampRef.current = await fetchStampForIds(res.writtenIds); } catch (e) { console.error("[QuoteBuilder] stamp refresh failed", e); }
      return res;
    } catch (err) {
      if (err instanceof QuoteChangedElsewhereError) { changedElsewhereRef.current = true; setChangedElsewhere(true); }
      throw err;
    }
  }, []);
  const { settings: companySettings } = useCompanySettings();
  const marginView = useMarginView(quoteId ?? null, (meta as any)?.company_id ?? null, mode === "agent" ? "agent" : "admin");
  const isCompact = useIsTabletOrBelow();
  // Phone/tablet: default to the Area Quote tab (search + areas + send), not
  // the Build/Visual PDF tabs which need desktop space.
  // R6: "quote" (area-first, edits saved lines directly) is the default view on every device.
  const [activeTab, setActiveTab] = useState(() => tabRef?.current ?? "quote");
  useEffect(() => { if (tabRef) tabRef.current = activeTab; }, [activeTab, tabRef]);
  // While the area-first view is open the basket replace-all autosave is paused, so the two
  // save paths can never overwrite each other; leaving it remounts the builder from saved lines.
  const livePausedRef = useRef(activeTab === "quote");
  livePausedRef.current = activeTab === "quote";
  const liveUsedRef = useRef(activeTab === "quote");
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
  // Rates snapshot in deps: live-priced lines refresh when Units %/Materials % change.
  const rateSnap = useSyncExternalStore(subscribeQuoteMarkupRates, getQuoteMarkupRatesSnapshot);
  const displayState = useMemo(() => {
    const state = basketsToQuoteState(displayBaskets);
    const labour = ctxItems.filter(isLabourItem).map((row) => ({ ...row,
      area_id: state.areas.find((a) => a.id === row.area_id || a.name.trim().toLowerCase() === ctxAreas.find((old) => old.id === row.area_id)?.name.trim().toLowerCase())?.id ?? row.area_id,
    }));
    return { ...state, items: reconcileAutoLabour([...state.items, ...labour], state.areas, normalizeLabourMode(meta?.labour_mode), companySettings.default_install_labour_hours, companySettings.default_hourly_rate) };
  }, [displayBaskets, ctxItems, ctxAreas, meta?.labour_mode, companySettings.default_install_labour_hours, companySettings.default_hourly_rate, rateSnap]);
  const displayQuoteTotals = useMemo(
    // Labour rows live outside the baskets (LabourPanel) — add them so totals include labour.
    () => activeTab === "quote"
      // Area-first view edits saved lines: totals come straight from them (same maths as the estimate page).
      ? computeQuoteTotals(ctxItems, ctxAreas, undefined, { type: meta?.discount_type, value: meta?.discount_value })
      : computeQuoteTotals(
      displayState.items,
      displayState.areas,
      undefined,
      { type: meta?.discount_type, value: meta?.discount_value },
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, displayState, ctxItems, ctxAreas, meta?.discount_type, meta?.discount_value],
  );
  // Build Area Quote Pricing / Review / footer: same totals as the header, split per area.
  const areaReview = useMemo(
    () => buildAreaReview(displayBaskets, displayState.items, displayState.areas, displayQuoteTotals, marginView.visible),
    [displayBaskets, displayState, displayQuoteTotals, marginView.visible],
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
      vat: displayQuoteTotals.vatAmount,
      total: displayQuoteTotals.total,
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
      const { data, error } = await liveProducts().
      select("id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, pipe_liquid, pipe_gas, is_material_favorite, suggested_consumables, pack_qty, default_markup_percent, is_active, pdf_upload_id, suppliers(name, supplier_type)").
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
        markup_percent: resolveProductMarkupPercent(p as any),
        default_markup_percent: resolveProductMarkupPercent(p as any),
      })) as PaletteProduct[];
    },
    staleTime: 60000
  });

  const areaFilteredProducts = useMemo(() => {
    let result = products;
    if (!areaDebouncedSearch.trim() && !["all", "favorites", "recent", "piping"].includes(areaCategoryFilter)) {
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

  const { ids: areaFavorites, toggle: toggleQuoteFavourite } = useQuoteFavourites();
  const { data: paletteCatalogAllowlist } = useQuery({
    queryKey: ["visual-catalog-allowlist"],
    queryFn: fetchVisualCatalogAllowlist,
    staleTime: 60000,
  });
  const isPhone = useIsPhone();
  const { templates: favInstallTemplates } = useInstallTemplates();
  const [favSheetOpen, setFavSheetOpen] = useState(false);
  const [favAreaId, setFavAreaId] = useState<string>("");

  /**
   * Hydrate baskets from the unified quote (context items+areas) so the
   * "Build" tab body reflects the same data the header summary reads. Without
   * this, opening an existing quote left the body at its default empty basket
   * even though the header showed the real totals — the split-brain bug.
   *
   * We build stub PaletteProducts using the stored unit_price so per-item
   * totals match `quote_items.total_price` exactly (no markup recompute).
   */
  const { bundles: kitBundles, bundlesLoading: kitBundlesLoading } = useQuoteBuilderBundles();
  const initialBaskets = useMemo<Basket[] | null>(() => {
    if (ctxLoading || kitBundlesLoading) return null;
    // Real = non-placeholder AND has qty/rate. Zero-value non-placeholder rows
    // must not hydrate (mirrors reuse rule).
    const realItems = ctxItems.filter(
      (i) =>
        i.source !== "legacy_placeholder" &&
        !isLabourItem(i) &&
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
    // Shared, tested helper — saved lines are PRICE-LOCKED (never re-marked-up).
    const stub = (it: typeof ctxItems[number]): PaletteProduct => stubProductFromQuoteItem(it);
    const toItem = (it: typeof ctxItems[number]) => {
      const product = (it.product_id && productById.get(it.product_id)) || stub(it);
      return {
        instanceId: it.id,
        product: stub(it), // always use stub so total = stored unit_price * qty
        quantity: it.quantity,
        ...(it.length ? { length: it.length } : {}),
        ...(it.is_bundle ? { isBundle: true } : {}),
        ...(basketInstallFrom(it) ? { install: basketInstallFrom(it) } : {}),
        ...(() => {
          const k = kitFromSavedItem(it);
          return k ? kitBasketFields(k) : {};
        })(),
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
      items: collapseExplodedKits(groups.get(a.id) || [], kitBundles as any).map(toItem),
    }));
    if (unassigned.length) result.push({ id: "unassigned", name: "General", items: collapseExplodedKits(unassigned, kitBundles as any).map(toItem) });
    return result;
  }, [ctxLoading, ctxItems, ctxAreas, products, kitBundles, kitBundlesLoading]);


  /**
   * Seed the Area/Wizard builder with real DB items so the Areas step shows
   * the actual line items rather than the "Additional Items/Services"
   * placeholder. We classify each item into acUnits / materials / consumables
   * based on category and length.
   */
  const initialWizardAreas = useMemo<WizardQuoteArea[] | null>(() => {
    if (ctxLoading || kitBundlesLoading) return null;
    // Same "real item" rule as reuse/hydration guards.
    const realItems = ctxItems.filter(
      (i) =>
        i.source !== "legacy_placeholder" &&
        !isLabourItem(i) &&
        !i.parent_item_id &&
        ((i.quantity ?? 0) > 0 || (i.unit_price ?? 0) > 0 || (i.total_price ?? 0) > 0)
    );
    if (realItems.length === 0 && ctxAreas.length === 0) return null;
    const productById = new Map(products.map((p) => [p.id, p]));
    const metadataMarkup = (it: typeof ctxItems[number]) => {
      const markup = Number((it.metadata as Record<string, unknown>)?.markup_percent);
      return Number.isFinite(markup) && markup > 0 ? markup : 0;
    };
    // Shared, tested helper — saved lines are PRICE-LOCKED (never re-marked-up).
    const stubProduct = (it: typeof ctxItems[number]): PaletteProduct => stubProductFromQuoteItem(it);
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
      // Old quotes stored kits as separate lines — collapse them to one kit.
      for (const it of collapseExplodedKits(list, kitBundles as any)) {
        const product = (it.product_id && productById.get(it.product_id)) || stubProduct(it);
        const cat = (product.product_category || product.category || "").toLowerCase();
        const isAC = cat.includes("air") || cat.includes(" ac") || cat === "ac" || cat.includes("hvac");
        const savedKit = kitFromSavedItem(it);
        if (savedKit) {
          base.materials.push({ ...savedKit, install: basketInstallFrom(it) });
          if (savedKit.bundleId) base.appliedBundleId = savedKit.bundleId;
          continue;
        }
        if (isAC) {
          base.acUnits.push({ id: it.id, fromSaved: true, product: stubProduct(it), btu: detectBTU(product), quantity: it.quantity });
        } else if (it.length && it.length > 0) {
          // unit_price on a length line is the price for the WHOLE length (qty 1),
          // so derive the true per-metre rate instead of multiplying by length twice.
          // costPerMeter must be COST (the wizard applies the line's own
          // sell/cost ratio on top) — taken from the price-locked stub.
          const sp = stubProduct(it);
          const lockedCost = Number(sp.locked_cost_ex_vat ?? sp.locked_sell_ex_vat) || 0;
          const perM = lockedCost / it.length;
          base.materials.push({
            id: it.id,
            product: sp,
            defaultLength: it.length,
            adjustedLength: it.length,
            costPerMeter: perM,
            totalCost: perM * it.length,
            pricingMode: "length",
            unitQuantity: 1,
            install: basketInstallFrom(it),
          });
        } else if ((it.metadata as any)?.qty_unit === "metre" && (it.metadata as any)?.waste_percent != null) {
          // Waste-priced metre line: keep decimal metres + saved price (qty = metres).
          base.materials.push({ id: it.id, product: stubProduct(it), defaultLength: 1, adjustedLength: 1, costPerMeter: 0, totalCost: 0, pricingMode: "unit", unitQuantity: Number(it.quantity) || 0.1, install: basketInstallFrom(it) });
        } else {
          base.consumables.push({ id: it.id, product: stubProduct(it), quantity: it.quantity, install: basketInstallFrom(it) });
        }
      }
      base.subtotal = computeAreaSubtotal(base);
      // Only include non-empty areas, plus any explicitly declared ctxAreas
      if (base.acUnits.length || base.materials.length || base.consumables.length || key) {
        result.push(base);
      }
    }
    return result.length > 0 ? result : null;
  }, [ctxLoading, ctxItems, ctxAreas, products, kitBundles, kitBundlesLoading]);


  // Refs to the inline builder's methods
  const areaAddProductRef = useRef<((product: PaletteProduct, opts?: { append?: boolean }) => void) | null>(null);
  const areaDropProductToAreaRef = useRef<((areaId: string, product: PaletteProduct, opts?: { append?: boolean }) => void) | null>(null);
  const areaDropBundleToAreaRef = useRef<((areaId: string, bundle: any) => void) | null>(null);
  const areaAddZoneRef = useRef<(() => void) | null>(null);
  const areaApplyTemplateRef = useRef<((zoneNames: string[]) => void) | null>(null);
  const areaClearAllRef = useRef<(() => void) | null>(null);

  // Shared PDF product selection state
  const [selectedFromPdf, setSelectedFromPdf] = useState<PdfSelectedProduct[]>(() => readPdfBasket(quoteId));
  const { find: findSpecial } = useActiveSpecials();
  const specialPrompt = useSpecialPrompt();
  // Persist the basket per quote (shared with the estimate page drop-downs).
  const basketKeyRef = useRef<string | null>(null);
  const basketJsonRef = useRef<string>("");
  useEffect(() => {
    if (quoteId) migrateDraftPdfBasket(quoteId);
    const next = readPdfBasket(quoteId);
    basketKeyRef.current = pdfBasketKey(quoteId);
    basketJsonRef.current = JSON.stringify(next);
    setSelectedFromPdf(next);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== basketKeyRef.current) return;
      const v = readPdfBasket(quoteId);
      basketJsonRef.current = JSON.stringify(v);
      setSelectedFromPdf(v);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [quoteId]);
  useEffect(() => {
    if (basketKeyRef.current !== pdfBasketKey(quoteId)) return;
    const json = JSON.stringify(selectedFromPdf);
    if (json === basketJsonRef.current) return;
    basketJsonRef.current = json;
    writePdfBasket(quoteId, selectedFromPdf);
  }, [selectedFromPdf, quoteId]);
  const [floatingOpen, setFloatingOpen] = useState(false);

  const handleSelectProduct = useCallback((product: Pick<PdfSelectedProduct, "code" | "description" | "price"> & Partial<Pick<PdfSelectedProduct, "costPrice" | "markupPercent">>) => {
    setSelectedFromPdf((prev) => {
      if (prev.some((p) => p.code === product.code)) {
        return prev.filter((p) => p.code !== product.code);
      }
      return [...prev, { ...product, quantity: 1, unitType: "units", costPrice: product.costPrice, markupPercent: product.markupPercent }];
    });
  }, []);

  const updateSelectedItem = useCallback((code: string, updates: Partial<PdfSelectedProduct>) => {
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
      select("id, bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, sort_order, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, cost_price, default_markup_percent, supplier_discount_percent, markup_percent, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pack_qty, unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty, is_active, pdf_upload_id, suppliers(name))").
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
            default_markup_percent: resolveProductMarkupPercent(sp as any),
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

      // Items resolve LIVE by model number (lib/bundleResolve.ts); not found → zero-priced "Not found" placeholder.
      return resolveBundlesLive(bundleData.map((b) => ({ ...b, items: itemsByBundle[b.id] || [] })) as any) as any;
    },
    staleTime: 60000
  });

  const paletteCatalog = useMemo(
    () => filterPaletteCatalog(areaFilteredProducts, bundles, paletteCatalogAllowlist),
    [areaFilteredProducts, bundles, paletteCatalogAllowlist],
  );

  // Add product to basket handler for Visual tab
  const addProductToBasket = useCallback((basketId: string, product: PaletteProduct) => {
    setBaskets((prev) => {
      // Ensure at least one basket exists
      let updated = prev.length > 0 ? [...prev] : [{ id: "basket-1", name: "Zone 1", items: [] }];
      return updated.map((basket) => {
        if (basket.id !== basketId) return basket;
        const existing = basket.items.find((i) => i.product.id === product.id && canMergeRepick(i.product, product));
        if (existing) {
          return {
            ...basket,
            items: basket.items.map((i) =>
            i === existing ? { ...i, quantity: i.quantity + 1 } : i
            )
          };
        }
        return {
          ...basket,
          items: [
          ...basket.items,
          {
            instanceId: `${product.id}-${Date.now()}`,
            product: freshProduct(product),
            quantity: 1,
            ...(product.sold_in_length && product.price_per_metre ? { length: 1 } : {})
          }]

        };
      });
    });
  }, []);

  /* ── PDF selection → the OPEN quote (area-pick + never silent wipe) ──
     Selections stay parked in the left basket until they are successfully
     written into a real quote area (quote_items + the matching basket, which
     the auto-save mirrors). Nothing is cleared on failure or cancel. */
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState("");
  const [committingPdf, setCommittingPdf] = useState(false);
  const [seedPdfDescription, setSeedPdfDescription] = useState(true);

  const commitSelectionToArea = useCallback(
    async (areaId: string, areaName: string) => {
      if (selectedFromPdf.length === 0) return;
      setCommittingPdf(true);
      const committed: string[] = [];
      const failed: string[] = [];
      const addedRowIds: string[] = [];
      let sortOrder = ctxItems.length ? Math.max(...ctxItems.map((i) => i.sort_order || 0)) + 1 : 0;

      // Specials overlay: ask per running special; Yes = special cost on THIS line only, standard markup on top.
      const specialMeta = new Map<string, Record<string, any>>();
      const toCommit: PdfSelectedProduct[] = [];
      for (const item of selectedFromPdf) {
        const sp = findSpecial(item.productId || null, item.productCode || null);
        if (!sp) { toCommit.push(item); continue; }
        const normal = item.costPrice != null ? Number(item.costPrice) : 0;
        if (await specialPrompt.ask(sp, normal)) {
          const mk = resolveProductMarkupPercent(pdfItemToPaletteProduct(item) as any);
          const cost = Number(sp.special_cost);
          specialMeta.set(item.code, specialLineMeta(sp, normal));
          toCommit.push({ ...item, costPrice: cost, markupPercent: mk, price: String(standardSell(cost, mk)) } as PdfSelectedProduct);
        } else toCommit.push(item);
      }

      for (const item of toCommit) {
        const product = pdfItemToPaletteProduct(item);
        const quantity = item.quantity || 1;
        const unitSell = parseFloat(item.price) || 0;
        const unitCost = item.costPrice != null ? Number(item.costPrice) : 0;
        const markupPct = item.markupPercent != null ? Number(item.markupPercent) : resolveProductMarkupPercent(product as any);
        const row = await ctxAddItem({
          area_id: areaId,
          parent_item_id: null,
          product_id: item.productId || null,
          item_name: item.description || item.productCode || item.code,
          item_number: item.productCode || null,
          description: seedPdfDescription ? item.pdfDescription || item.description || null : null,
          quantity,
          length: null,
          unit_price: Number(unitSell.toFixed(2)),
          total_price: null,
          is_bundle: false,
          item_type: "product",
          metadata: { unit_cost: Number(unitCost.toFixed(2)), markup_percent: markupPct, quote_category: classifyQuoteCategory(product as any), ...(specialMeta.get(item.code) || {}) },
          sort_order: sortOrder++,
          notes: null,
          source: "catalog",
          supplier: item.supplierName || null,
        });
        if (row) { committed.push(item.code); if ((row as any).id) addedRowIds.push((row as any).id); }
        else failed.push(item.productCode || item.code);
      }

      if (addedRowIds.length && baselineStampRef.current) {
        try { baselineStampRef.current = mergeStamps(baselineStampRef.current, await fetchStampForIds(addedRowIds)); } catch (e) { console.error("[QuoteBuilder] stamp merge failed", e); }
      }
      if (committed.length > 0) {
        const committedSet = new Set(committed);
        const entries = toCommit
          .filter((i) => committedSet.has(i.code))
          .map((item) => {
            // Lock to exactly what was committed so auto-save can't re-price it.
            const sell = parseFloat(item.price) || 0;
            const mk = item.markupPercent != null ? Number(item.markupPercent) : 0;
            const cost = item.costPrice != null && Number(item.costPrice) > 0
              ? Number(item.costPrice)
              : mk > 0 ? sell / (1 + mk / 100) : null;
            return {
              product: { ...pdfItemToPaletteProduct(item), locked_sell_ex_vat: sell, locked_cost_ex_vat: cost } as PaletteProduct,
              quantity: item.quantity || 1,
            };
          });
        // Mirror into the basket for this area so the builder panes + auto-save
        // (replace-all from baskets) keep the freshly committed lines.
        setBaskets((prev) => {
          const list = prev.some((b) => b.id === areaId)
            ? [...prev]
            : [...prev, { id: areaId, name: areaName, items: [] as Basket["items"] }];
          return list.map((basket) => {
            if (basket.id !== areaId) return basket;
            const items = [...basket.items];
            entries.forEach(({ product, quantity }, idx) => {
              items.push({
                instanceId: `${product.id}-${Date.now()}-${idx}`,
                product,
                quantity,
              });
            });
            return { ...basket, items };
          });
        });
        // Only successfully committed selections leave the basket.
        setSelectedFromPdf((prev) => prev.filter((i) => !committedSet.has(i.code)));
        toast({ title: `Added ${committed.length} item${committed.length === 1 ? "" : "s"} to ${areaName}` });
      }

      if (failed.length > 0) {
        toast({
          title: `Couldn't add ${failed.length} item${failed.length === 1 ? "" : "s"}`,
          description: `${failed.slice(0, 3).join(", ")} stayed in your selection — try again.`,
          variant: "destructive",
        });
      }

      setCommittingPdf(false);
      setAreaPickerOpen(false);
      setNewAreaName("");
    },
    [selectedFromPdf, ctxItems, ctxAddItem, seedPdfDescription, findSpecial, specialPrompt],
  );

  /** Entry point from the Visual PDF "Add N to quote" button. */
  const addSelectedPdfToQuote = useCallback(() => {
    if (selectedFromPdf.length === 0) return;
    if (ctxAreas.length === 1) {
      void commitSelectionToArea(ctxAreas[0].id, ctxAreas[0].name);
      return;
    }
    setAreaPickerOpen(true);
  }, [selectedFromPdf, ctxAreas, commitSelectionToArea]);

  /** Create an area inline from the picker, then commit into it. */
  const commitSelectionToNewArea = useCallback(async () => {
    const name = newAreaName.trim();
    if (!name) return;
    setCommittingPdf(true);
    const area = await ctxAddArea(name);
    setCommittingPdf(false);
    if (!area) {
      toast({ title: "Couldn't create the area", description: "Your selection was kept — try again.", variant: "destructive" });
      return;
    }
    await commitSelectionToArea(area.id, area.name);
  }, [newAreaName, ctxAddArea, commitSelectionToArea]);


  // ---- Build with voice → Mandy quote mode (shared matcher + standard install) ----

  // Handle wizard save — merge new baskets
  const handleWizardSave = useCallback((newBaskets: Basket[]) => {
    setBaskets((prev) => [...prev, ...newBaskets]);
    setPopupPreviewBaskets([]);
    toast({ title: `Added ${newBaskets.length} zones from Area Quote Builder` });
    setAreaWizardOpen(false);
  }, []);

  // Switching tabs: the Area tab uses the inline builder, no modal popup
  const handleTabChange = useCallback(async (requestedTab: string) => {
    const tab = requestedTab === "normal" || requestedTab === "area" ? "quote" : requestedTab;
    if (tab === activeTab) return;
    if (tab === "quote") {
      await flushSaveRef.current?.(); // builder edits land first, then the live view takes over
      liveUsedRef.current = true;
      setActiveTab(tab);
      return;
    }
    if (activeTab === "quote") {
      skipFlushRef.current = true; // stale baskets must never save over live edits
      if (tabRef) tabRef.current = tab;
      await ctxRefetch();
      onRemount?.();
      return;
    }
    setActiveTab(tab);
  }, [activeTab, ctxRefetch, onRemount, tabRef]);
  useEffect(() => {
    if (activeTab === "normal" || activeTab === "area") void handleTabChange("quote");
  }, [activeTab, handleTabChange]);


  /* ── Generate Quote: persist the merged basket state (Build + Visual PDF +
     Area tabs) into the ONE unified quote, then open the send-to-client flow ── */
  const [sendOpen, setSendOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [labourDialog, setLabourDialog] = useState<{ id: string; name: string }[]>([]);
  const requireLabour = useCallback(() => {
    const missing = missingLabourFor(normalizeLabourMode((meta as any)?.labour_mode), ctxAreas, ctxItems, companySettings.default_install_labour_hours);
    if (missing.length) { setLabourDialog(missing); return false; }
    return true;
  }, [ctxAreas, ctxItems, companySettings.default_install_labour_hours, meta]);

  /* ── Mobile/tablet accordion for the Area tab: one full-screen scrollable
     section at a time (palette / areas / summary) ── */
  type AreaSectionKey = "palette" | "areas" | "summary";
  const [openSections, setOpenSections] = useState<Record<AreaSectionKey, boolean>>({
    palette: true,
    areas: false,
    summary: false,
  });
  // One working pane at a time on small screens: opening a section closes
  // the others; tapping the open section closes it (headers stay visible).
  const toggleSection = useCallback((key: AreaSectionKey) => {
    setOpenSections((prev) =>
      prev[key]
        ? { ...prev, [key]: false }
        : { palette: false, areas: false, summary: false, [key]: true }
    );
  }, []);
  /* True full-page mode for the Product Palette: hides the Area Quote and
     Quote Summary headers/content entirely so the palette fills the screen */
  const [paletteMaximized, setPaletteMaximized] = useState(false);

  /* Phone/tablet: Products / Area Quote / Quote Summary are three full pages
     you swipe-scroll through vertically, or step through with Next/Back. */
  const areaPagesRef = useRef<HTMLDivElement>(null);
  const [areaPage, setAreaPage] = useState(0);
  const goToAreaPage = useCallback((index: number) => {
    const container = areaPagesRef.current;
    if (!container) return;
    const clamped = Math.max(0, Math.min(2, index));
    container.scrollTo({ top: clamped * container.clientHeight, behavior: "smooth" });
    setAreaPage(clamped);
  }, []);
  const handleAreaPagesScroll = useCallback(() => {
    const container = areaPagesRef.current;
    if (!container || container.clientHeight === 0) return;
    const idx = Math.round(container.scrollTop / container.clientHeight);
    setAreaPage((prev) => (prev === idx ? prev : Math.max(0, Math.min(2, idx))));
  }, []);

  const handleGenerateQuote = useCallback(async () => {
    if (!quoteId) return;
    if (!requireLabour()) return;
    if ((livePausedRef.current ? ctxItems.length : displayQuoteTotals.itemCount) === 0) {
      toast({ title: "Nothing to quote", description: "Add at least one line item first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const validIds = new Set(products.map((p) => p.id));
      // Area-first view edits saved lines directly: nothing to persist from baskets.
      if (!livePausedRef.current) await guardedPersist(quoteId, displayBaskets, validIds);
      // Send = shareable client link. Shared helper ensures public_token
      // exists and moves a draft to sent — never touches accepted/declined.
      await ensureQuoteReadyToSend(quoteId);
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
  }, [quoteId, displayBaskets, displayQuoteTotals.itemCount, products, requireLabour, guardedPersist, ctxItems.length]);

  /* ────────────────────────────────────────────────────────────────────
     Auto-save into THE linked quote + accidental-close guard.
     The builder never keeps work only in local state: every basket/area
     edit is debounced into this quote's quote_items / quote_areas, and
     leaving the builder flushes a save first.
     ──────────────────────────────────────────────────────────────────── */
  const exitTo = mode === "agent" ? "/field" : "/admin/quotes";

  // Content signature of everything on screen (all three tabs merged).
  const contentSig = useMemo(
    () =>
      JSON.stringify(
        displayBaskets.map((b) => [
          b.name,
          b.items.map((i) => [
            i.product?.id,
            i.quantity,
            (i as { length?: number }).length ?? null,
            i.product?.selling_price ?? i.product?.cost_price ?? 0,
          ]),
        ])
      ),
    [displayBaskets]
  );

  // Number of real persisted items, used to know when hydration has landed.
  const persistedRealCount = useMemo(
    () =>
      ctxItems.filter(
        (i) =>
          i.source !== "legacy_placeholder" &&
          !i.parent_item_id &&
          ((i.quantity ?? 0) > 0 || (i.unit_price ?? 0) > 0 || (i.total_price ?? 0) > 0)
      ).length,
    [ctxItems]
  );

  // Baseline = the state as loaded. Only set once hydration has actually
  // flowed into the baskets, so an empty pre-hydration render can never be
  // auto-saved over a quote that has lines.
  const baselineSigRef = useRef<string | null>(null);
  // Snapshot of the baskets exactly as the quote was opened (hydration
  // baseline). Discard restores the DB to this so auto-save writes are undone.
  const baselineBasketsRef = useRef<typeof displayBaskets | null>(null);
  // True once auto-save has actually written to this quote in this session.
  const hasWrittenRef = useRef(false);
  // Set by Discard so the unmount flush cannot re-save the discarded basket.
  const skipFlushRef = useRef(false);

  useEffect(() => {
    if (ctxLoading || baselineSigRef.current !== null) return;
    if (persistedRealCount > 0 && displayQuoteTotals.itemCount === 0) return;
    baselineSigRef.current = contentSig;
    baselineBasketsRef.current = displayBaskets;
  }, [ctxLoading, persistedRealCount, displayQuoteTotals.itemCount, contentSig, displayBaskets]);

  const isDirty = baselineSigRef.current !== null && contentSig !== baselineSigRef.current;

  // Refs so the unmount/beforeunload flush always sees the latest state.
  const savingRef = useRef(false);
  const lastSaveErrorToastRef = useRef(0);
  const latestRef = useRef({ quoteId, displayBaskets, products, contentSig, isDirty });
  latestRef.current = { quoteId, displayBaskets, products, contentSig, isDirty };

  const flushSave = useCallback(async () => {
    const { quoteId: qid, displayBaskets: dbk, products: prods, contentSig: sig, isDirty: dirty } =
      latestRef.current;
    if (!qid || !dirty || savingRef.current || skipFlushRef.current || livePausedRef.current) return;
    if (othersRef.current.length > 0 || changedElsewhereRef.current) return; // paused: never write over another editor
    savingRef.current = true;
    try {
      // Only ever writes into the already-open quote — never inserts a quote.
      // Tracked so the shared action bar's Save/PDF/Send waits for an in-flight basket save.
      await trackQuoteWrite(guardedPersist(qid, dbk, new Set(prods.map((p) => p.id))));
      hasWrittenRef.current = true;
      baselineSigRef.current = sig;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[QuoteBuilder] auto-save failed", err);
      if (err instanceof QuoteChangedElsewhereError) return;
      if (Date.now() - lastSaveErrorToastRef.current > 15_000) {
        lastSaveErrorToastRef.current = Date.now();
        toast({ title: "Changes not saved", description: "You can only edit quotes where you are the salesperson. Ask an admin to reassign it.", variant: "destructive" });
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);
  flushSaveRef.current = flushSave;
  const docActions = useQuoteDocumentActions(quoteId, { beforeWrite: () => flushSaveRef.current?.() });
  // Mandy "make the PDF" (and old /admin/estimates/:id?mandy=pdf links) run once here.
  const [mandyParams, setMandyParams] = useSearchParams();
  const mandyPdfRan = useRef(false);
  useEffect(() => {
    if (mandyParams.get("mandy") !== "pdf" || mandyPdfRan.current || !quoteId || ctxLoading) return;
    mandyPdfRan.current = true;
    const next = new URLSearchParams(mandyParams); next.delete("mandy"); setMandyParams(next, { replace: true });
    void docActions.handlePdf();
  }, [mandyParams, quoteId, ctxLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save while editing.
  useEffect(() => {
    if (!isDirty) return;
    const t = setTimeout(() => { void flushSave(); }, 1200);
    return () => clearTimeout(t);
  }, [isDirty, contentSig, flushSave, otherEditors.length]);

  // Flush on unmount (route change of any kind) and on tab close.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!latestRef.current.isDirty || skipFlushRef.current || livePausedRef.current) return;
      if (othersRef.current.length > 0 || changedElsewhereRef.current) return;
      void flushSave();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushSave();
    };
  }, [flushSave]);

  // Mandy writes from this session are local: flush builder edits first, then
  // re-hydrate (parent remounts us) so replace-all never wipes her lines.
  useEffect(() => {
    if (!bridgeRef) return;
    const REFUSE = "I didn't change anything: this quote was changed elsewhere (or has unsaved builder changes that can't be saved right now). Reload the builder first.";
    bridgeRef.current = {
      prepareRemount: () => { skipFlushRef.current = true; },
      beforeWrite: async () => {
        const qid = latestRef.current.quoteId;
        if (!qid) return null;
        await waitForBuilderSaves(qid);
        while (savingRef.current) await new Promise((r) => setTimeout(r, 50));
        const dirtyNow = () => baselineSigRef.current !== null && latestRef.current.contentSig !== baselineSigRef.current;
        if (dirtyNow()) {
          if (othersRef.current.length > 0 || changedElsewhereRef.current) return REFUSE;
          await flushSave();
          if (dirtyNow()) return REFUSE;
        }
        if (changedElsewhereRef.current) return REFUSE;
        const base = baselineStampRef.current;
        try {
          if (base && stampChanged(base, await fetchQuoteLineStamp(qid))) {
            changedElsewhereRef.current = true; setChangedElsewhere(true);
            return REFUSE;
          }
        } catch { return REFUSE; }
        return null;
      },
    };
    return () => { if (bridgeRef.current) bridgeRef.current = null; };
  }, [bridgeRef, flushSave]);

  const leaveBuilder = useCallback(() => navigate(exitTo), [navigate, exitTo]);

  // Discard: undo any auto-saved writes by restoring the opening snapshot,
  // then leave without letting the unmount flush re-save.
  const discardAndLeave = useCallback(async () => {
    skipFlushRef.current = true;
    const qid = latestRef.current.quoteId;
    // After area-first edits the opening snapshot is stale — never restore it over live work.
    if (qid && hasWrittenRef.current && !liveUsedRef.current) {
      try {
        await guardedPersist(
          qid,
          baselineBasketsRef.current ?? [],
          new Set(latestRef.current.products.map((p) => p.id)),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[QuoteBuilder] discard restore failed", err);
        if (err instanceof QuoteChangedElsewhereError) toast({ title: "Not discarded: the quote was changed elsewhere", variant: "destructive" });
        else toast({
          title: "Could not fully discard",
          description: "Some changes may remain on the quote.",
          variant: "destructive",
        });
      }
    }
    leaveBuilder();
  }, [leaveBuilder, guardedPersist]);

  const exitGuard = useUnsavedQuoteGuard({
    isDirty,
    canSave: true,
    // A quote always carries a customer (DB trigger enforces it), so skip the
    // associate-client gate when the client is already on the quote.
    hasClient: !!meta?.customer_id,
    onSaveDraft: async () => {
      await flushSave();
      toast({ title: "Draft saved" });
      leaveBuilder();
    },
    onAssociateClient: () => {
      // Stay in the builder — the header client selector is right there.
    },
    onDiscard: discardAndLeave,
    onExit: leaveBuilder,
  });

  // Browser / hardware back: intercept while dirty and prompt instead.
  const requestExitRef = useRef(exitGuard.requestExit);
  requestExitRef.current = exitGuard.requestExit;
  useEffect(() => {
    window.history.pushState({ quoteBuilderGuard: true }, "");
    const onPopState = () => {
      if (latestRef.current.isDirty) {
        window.history.pushState({ quoteBuilderGuard: true }, "");
        requestExitRef.current();
      } else {
        leaveBuilder();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [leaveBuilder]);


  const summaryNode = (
    <>
      {marginView.visible && (
        <div className="mb-2"><PricingChecksRow settings={marginView.settings} discount={Number(displayQuoteTotals.discountAmount ?? 0)} /></div>
      )}
      <div className="mb-3"><LabourPanel /></div>
      <QuoteSummaryPanel baskets={displayBaskets} totals={displayQuoteTotals} quoteId={quoteId} onGenerateQuote={handleGenerateQuote} hideSend={isCompact} showCost={marginView.visible} />
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-background">
      {specialPrompt.dialog}

      <QuoteSharedHeader onBack={() => exitGuard.requestExit()} />
      {exitGuard.ExitDialog}


      {/* Which area do these PDF selections belong to? Cancel keeps them parked. */}
      <Dialog open={areaPickerOpen} onOpenChange={(o) => { if (!committingPdf) setAreaPickerOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which area?</DialogTitle>
            <DialogDescription>
              {selectedFromPdf.length} selected item{selectedFromPdf.length === 1 ? "" : "s"} — pick an area or add a new one.
              Nothing is removed from your selection until it lands on the quote.
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={seedPdfDescription}
              onChange={(e) => setSeedPdfDescription(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Use the catalog / PDF description as the line description (editable after)
          </label>

          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {ctxAreas.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No areas yet — name one below.</p>
            )}
            {ctxAreas.map((a) => (
              <Button
                key={a.id}
                variant="outline"
                className="w-full justify-start"
                disabled={committingPdf}
                onClick={() => void commitSelectionToArea(a.id, a.name)}
              >
                {a.name}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              placeholder="New area name"
              className="h-9"
              onKeyDown={(e) => { if (e.key === "Enter") void commitSelectionToNewArea(); }}
            />
            <Button disabled={committingPdf || !newAreaName.trim()} onClick={() => void commitSelectionToNewArea()}>
              Add area
            </Button>
          </div>

          <DialogFooter>
            <Button variant="ghost" disabled={committingPdf} onClick={() => setAreaPickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={labourDialog.length > 0} onOpenChange={(open) => { if (!open) setLabourDialog([]); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Labour missing</DialogTitle><DialogDescription>Add labour to every populated area before continuing.</DialogDescription></DialogHeader>
          <div className="space-y-1">{labourDialog.map((area) => <Button key={area.id} variant="ghost" className="w-full justify-start" onClick={() => { setLabourDialog([]); window.setTimeout(() => document.getElementById(`area-labour-${area.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }}>{area.id === "job" ? "Job labour" : area.name}</Button>)}</div>
        </DialogContent>
      </Dialog>


      {/* Builder mode tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="relative z-[10001] shrink-0">
        <div className="flex flex-wrap items-center justify-center gap-y-1 py-1 bg-muted/40">
          <TabsList className="h-8 bg-muted">
            <TabsTrigger value="quote" className="text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4 font-semibold">Build quote</TabsTrigger>
            <TabsTrigger value="normal" disabled aria-hidden="true" className="hidden text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4">Build</TabsTrigger>
            <TabsTrigger value="visual" className="text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4">Visual PDF</TabsTrigger>
            <TabsTrigger value="area" disabled aria-hidden="true" className="hidden text-xs text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground px-4">Build Area Quote</TabsTrigger>
            <Button
              size="icon"
              variant="outline"
              onClick={() => openMandyQuoteMode()}
              aria-label="Build with voice"
              className="h-7 w-7 ml-0.5 border-transparent bg-transparent hover:bg-accent"
              title="Build with voice — Ask Mandy"
            >
              <Mic className="h-3.5 w-3.5" />
            </Button>
          </TabsList>
        </div>
      </Tabs>

      {/* Record strip from the archived estimate page: status, deposit, staff menu, Convert to Invoice */}
      {quoteId && meta && (
        <div className="shrink-0 px-3 pb-2"><QuoteRecordStrip quote={meta} checkLabour={docActions.checkLabour} /></div>
      )}

      {/* Accounting step 1: how this quote is paid (locked once invoiced) */}
      {quoteId && meta?.status !== "declined" && (
        <div className="shrink-0 px-3 pb-2">
          <PaymentPlanPicker quoteId={quoteId} />
        </div>
      )}

      {/* Post-acceptance: deposit invoice + hand over to installation */}
      {quoteId && meta?.status === "accepted" && (
        <div className="shrink-0 px-3 pb-2">
          <AcceptedWorkSection quoteId={quoteId} />
        </div>
      )}

      {/* Tab content */}

      {changedElsewhere ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex-1">This quote was changed on the estimate page or another device. Builder saving is paused so nothing is lost.</span>
          <Button type="button" size="sm" variant="destructive" onClick={() => window.location.reload()}>Reload builder</Button>
        </div>
      ) : otherEditors.length > 0 && (
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {otherEditors[0].name} also has this quote open on the {otherEditors[0].surface === "estimate" ? "estimate page" : "builder"}. Builder saving is paused so their changes aren't overwritten.
        </div>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {ctxLoading && (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
              <p className="text-sm text-white/80">Loading quote…</p>
            </div>
          </div>
        )}
        {!ctxLoading && activeTab === "quote" && (
          <div className="h-full overflow-y-auto bg-muted/30" data-testid="area-first-view">
            <AreaFirstBuilder pdfBasket={selectedFromPdf} />
          </div>
        )}
        {!ctxLoading && activeTab === "normal" &&
        <QuoteBuilderLayout compact={isCompact} side={summaryNode} middle={
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
                    reviewSummary={areaReview}
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
            } />
        }
        {!ctxLoading && activeTab === "visual" &&
        <QuoteBuilderLayout compact={isCompact} side={summaryNode} stickyPad="0px" middle={
              <VisualCatalogPanel
              showCost={marginView.visible}
              open={true}
              onClose={() => void handleTabChange("quote")}
              baskets={baskets}
              onAddProductToBasket={addProductToBasket}
              onAddSelectedToQuote={addSelectedPdfToQuote}
              products={products}
              isDragging={false}
              onOpenWizard={handleOpenWizardFromVisual}
              pdfSearchRef={pdfSearchRef}
              wizardOpen={areaWizardOpen}
              pdfSelection={{ selectedFromPdf, setSelectedFromPdf, handleSelectProduct, updateSelectedItem }} />

            } />
        }
        {!ctxLoading && activeTab === "area" && (() => {
          const pickFavourite = (product: PaletteProduct) => {
            const areaId = wizardAreas.some((a) => a.id === favAreaId) ? favAreaId : (wizardAreas[wizardAreas.length - 1]?.id ?? "__auto__");
            const append = isAirConditioningProduct(product);
            if (areaId === "__auto__") areaAddProductRef.current?.(product, { append });
            else areaDropProductToAreaRef.current?.(areaId, product, { append });
            if (append) {
              const plan = planStandardInstall(product, favInstallTemplates, kitBundles as any, products);
              if (plan.notes.length) toast({ title: "Install note", description: plan.notes.join(" · ") });
            }
          };
          const paletteEl = (
            <>
            {isPhone && (
              <div className="p-2">
                <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setFavSheetOpen(true)}>★ Favourites</Button>
                <Sheet open={favSheetOpen} onOpenChange={setFavSheetOpen}>
                  <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                    <SheetHeader><SheetTitle>★ Favourites</SheetTitle></SheetHeader>
                    {wizardAreas.length > 0 && (
                      <div className="my-2">
                        <Select value={wizardAreas.some((a) => a.id === favAreaId) ? favAreaId : wizardAreas[wizardAreas.length - 1].id} onValueChange={setFavAreaId}>
                          <SelectTrigger aria-label="Area"><SelectValue /></SelectTrigger>
                          <SelectContent>{wizardAreas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <FavouritesPicker products={products} services={[]} onPickProduct={pickFavourite} />
                  </SheetContent>
                </Sheet>
              </div>
            )}
            <ProductPalette
              products={paletteCatalog.products}
              isLoading={false}
              searchQuery={areaSearch}
              onSearchChange={setAreaSearch}
              categoryFilter={areaCategoryFilter}
              onCategoryChange={setAreaCategoryFilter}
              isDragging={false}
              favorites={areaFavorites}
              onToggleFavorite={(id) => void toggleQuoteFavourite(id)}
              usageMap={areaUsageMap}
              bundles={paletteCatalog.bundles}
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
            </>
          );
          const areaEl = (
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
          );
          const summaryEl = (
            <>
              <div className="mb-3"><LabourPanel /></div>
              <QuoteSummaryPanel baskets={displayBaskets} totals={displayQuoteTotals} quoteId={quoteId} onGenerateQuote={handleGenerateQuote} showCost={marginView.visible} />
            </>
          );

          if (isCompact) {
            const pageLabels = ["Products", "Area Quote", "Quote Summary"];
            return (
              <div className="h-full flex flex-col overflow-hidden">
                <div
                  ref={areaPagesRef}
                  onScroll={handleAreaPagesScroll}
                  className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory scroll-smooth"
                  style={{ WebkitOverflowScrolling: "touch" as any }}
                >
                  <section className="h-full snap-start flex flex-col min-h-0 overflow-hidden">
                    {paletteEl}
                  </section>
                  <section className="h-full snap-start flex flex-col min-h-0 overflow-hidden">
                    {areaEl}
                  </section>
                  <section className="h-full snap-start overflow-y-auto bg-card">
                    {summaryEl}
                  </section>
                </div>
                <div className="shrink-0 flex items-center justify-between gap-2 border-t bg-card px-3 py-2">
                  <button
                    type="button"
                    onClick={() => goToAreaPage(areaPage - 1)}
                    disabled={areaPage === 0}
                    className="text-xs font-medium text-muted-foreground disabled:opacity-40 px-2 py-1"
                  >
                    Back
                  </button>
                  <div className="flex items-center gap-1.5">
                    {pageLabels.map((label, i) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => goToAreaPage(i)}
                        className={`h-1.5 rounded-full transition-all ${areaPage === i ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"}`}
                        aria-label={label}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => goToAreaPage(areaPage + 1)}
                    disabled={areaPage === 2}
                    className="text-xs font-semibold text-primary disabled:opacity-40 px-2 py-1"
                  >
                    {areaPage === 0 ? "Next: Area Quote" : areaPage === 1 ? "Next: Summary" : "Next"}
                  </button>
                </div>
              </div>
            );
          }

          return (
            <QuoteBuilderLayout compact={false} left={paletteEl} middle={areaEl} side={summaryEl} stickyPad="0px" />
          );
        })()}
      </div>

      {/* Shared Save draft · Download PDF · Send bar: Build quote tab at every width, and Visual PDF on phones/tablets
          (replaces the old total + Send bar there). Phones keep the live total and sit above the bottom nav. */}
      {quoteId && (activeTab === "quote" || isCompact) && (
        <div className="shrink-0 border-t bg-card px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] mb-16 lg:mb-0">
          <QuoteActionBar
            busy={docActions.busy}
            onSave={docActions.handleSave}
            onPdf={() => void docActions.handlePdf()}
            onSend={docActions.handleSend}
            onPrint={docActions.handlePrint}
            leading={isCompact ? (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total incl. VAT</p>
                <p className="truncate text-base font-bold tabular-nums text-foreground">{formatRand(displayQuoteTotals.total)}</p>
              </div>
            ) : undefined}
          />
        </div>
      )}
      {docActions.portals}

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
  const mandyBridgeRef = useRef<MandyBridge | null>(null);
  const builderTabRef = useRef<string | null>(null);
  const [builderEpoch, setBuilderEpoch] = useState(0);
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

        // Fetch recent quotes scoped to this lead/customer.
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
              .limit(5);
            return live ?? [];
          }
          if (resolvedCustomerId) {
            const { data } = await supabase
              .from("quotes")
              .select("id, created_at, sales_engineer_id, status")
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

        const openQuote = (id: string) => {
          if (!cancelled) {
            setQuoteId(id);
            setCreating(false);
          }
        };

        // Pass 1 — REAL quotes win: any non-draft (sent/viewed/accepted) or a
        // draft that already has line items/areas. These are never superseded.
        const toSupersede: string[] = [];
        const emptyOwnDrafts: string[] = [];
        for (const d of drafts) {
          const status = (d as any).status as string | undefined;
          if (status && status !== "draft") {
            openQuote(d.id);
            return;
          }
          if (await draftHasRealData(d.id)) {
            openQuote(d.id);
            return;
          }
          if (isRecentEmptyDraft(d as any)) emptyOwnDrafts.push(d.id);
          else toSupersede.push(d.id);
        }

        // Pass 1b — lead has no quote yet. Only adopt an UNLINKED draft for the
        // same customer (a basket started before the lead existed). Never open
        // a quote that belongs to another lead/job, and never a sent/accepted
        // one: auto-save is replace-all and would rewrite that job's lines.
        if (paramLeadId && resolvedCustomerId) {
          const { data: customerQuotes } = await supabase
            .from("quotes")
            .select("id, created_at, sales_engineer_id, status")
            .eq("customer_id", resolvedCustomerId)
            .is("lead_id", null)
            .eq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(10);
          for (const q of customerQuotes ?? []) {
            if (drafts.some((d: any) => d.id === q.id)) continue;
            if (await draftHasRealData(q.id)) {
              // Adopt it onto this lead so it stays a single source of truth.
              await (supabase.from("quotes") as any)
                .update({ lead_id: paramLeadId })
                .eq("id", q.id);
              openQuote(q.id);
              return;
            }
          }
        }

        // Pass 1c — nothing real anywhere: reuse our own recent empty draft.
        if (emptyOwnDrafts.length > 0) {
          const reuseId = emptyOwnDrafts[0];
          for (const oldId of [...emptyOwnDrafts.slice(1), ...toSupersede]) {
            await supersedeDraft(oldId, reuseId);
          }
          openQuote(reuseId);
          return;
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
      <BuilderMandyActions bridgeRef={mandyBridgeRef} onRemount={() => setBuilderEpoch((n) => n + 1)} />
      <UnifiedQuoteBuilderInner key={builderEpoch} mode={mode} bridgeRef={mandyBridgeRef} tabRef={builderTabRef} onRemount={() => setBuilderEpoch((n) => n + 1)} />
    </QuoteProvider>);

};

export default AdminQuoteBuilderPageUnified;
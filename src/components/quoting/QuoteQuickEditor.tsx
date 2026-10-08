import { productMatchesTerms } from "@/lib/productSearchTags";
import { liveProducts as liveProductsQuery } from "@/lib/liveProducts";
import { useActiveSpecials } from "@/hooks/useActiveSpecials";
import { SpecialChip, useSpecialPrompt } from "@/components/specials/SpecialsUi";
import { specialLineMeta } from "@/lib/specials";
import { resolveProductMarkupPercent } from "@/lib/pricing";
/**
 * QuoteQuickEditor — slim search bar that adds lines into the OPEN quote.
 *
 * It is deliberately NOT a second UI: it renders as one thin row of inputs that
 * sits inside the estimate document surface. All writes go through QuoteContext
 * into quote_items / quote_areas for the already-open quoteId. The Visual PDF
 * catalog stays in the full builder.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Star, Wrench, Package, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuoteFavourites, groupFavourites } from "@/hooks/useQuoteFavourites";
import type { PdfSelectedProduct } from "@/types/pdfSelection";
import FavouritesPicker from "@/components/quoting/FavouritesPicker";
import { getEffectiveUnitPrices, type PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { allTermsMatchBlob } from "@/components/catalog/searchSynonyms";
import { fetchVisualCatalogAllowlist, filterToVisualCatalog } from "@/lib/catalogSoT";
import { addCatalogProductToQuote, isAirConditioningProduct, catalogLineFields } from "@/lib/mandy/quoteOps";
import { isLengthProduct } from "@/lib/priceGuard";

/** "+ Add material" shows One Stop Shop (supplier_type 'consumables') only. */
export const isConsumable = (p: { supplier_type?: string | null }) => p?.supplier_type === "consumables";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { useInstallTemplates } from "@/hooks/useInstallTemplates";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";

import type { QuoteItemInsert } from "@/types/quote";
import { useToast } from "@/hooks/use-toast";
import { useCatalogServices } from "@/hooks/useCatalogServices";
import { Button } from "@/components/ui/button";
import {
  matchesService, serviceLineFields, isCustomLimitError, type CatalogService,
} from "@/lib/catalogServices";
import { decideAddTarget } from "@/lib/addBarTarget";
import { isAcUnitLine } from "@/lib/lineDisplay";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  dropUp = false,
  onAddedToArea,
  onUnitAdded,
  beforeCreateArea,
  targetAreaId,
  createTargetArea,
  mode,
  onClose,
  pdfBasket,
}: {
  onChanged?: () => void;
  /** Open the results list upward (used when the bar sits at the bottom of the document). */
  dropUp?: boolean;
  /** Focus the area that received the new line. */
  onAddedToArea?: (areaId: string) => void;
  onUnitAdded?: (areaId: string, quantity: number) => void;
  /** Explicit new-area guard; ordinary adds to existing areas remain unchanged. */
  beforeCreateArea?: () => boolean | Promise<boolean>;
  /** Commit straight into this area (no routing, no area picker). */
  targetAreaId?: string;
  /** Orphan default section: create the target area on first add. */
  createTargetArea?: () => Promise<string | null>;
  /** Which input shows/autofocuses in an area block. */
  /** "item" = ONE search over units + materials (area-first builder). */
  mode?: "unit" | "service" | "material" | "favourites" | "item" | "selected";
  onClose?: () => void;
  /** Read-only Visual PDF "Selected Items" basket; shown first and mapped to live catalogue rows. */
  pdfBasket?: PdfSelectedProduct[];
}) {
  const { areas, items, addItem, addArea, meta } = useQuoteContext();
  const { toast } = useToast();
  const companyId = (meta as any)?.company_id ?? null;
  const [serviceFocus, setServiceFocus] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const { bundles } = useQuoteBuilderBundles();
  const { templates } = useInstallTemplates();
  const { products: liveProducts } = useQuoteBuilderProducts();
  const { find: findSpecial } = useActiveSpecials();
  const specialPrompt = useSpecialPrompt();
  const dropdownPos = dropUp ? "bottom-full mb-1" : "mt-1";
  const { isFavourite, ids: favIds } = useQuoteFavourites();
  const [productTerm, setProductTerm] = useState("");
  const [serviceTerm, setServiceTerm] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  // Sync guard: a second fast click/Enter on ANY row is ignored until the add settles.
  const addingRef = useRef(false);
  const closeAfterAdd = () => {
    if (mode) { onClose?.(); return; }
    setProductTerm("");
    setServiceTerm("");
    setServiceFocus(false);
    const el = document.activeElement as HTMLElement | null;
    if (el && el.tagName === "INPUT") el.blur();
  };
  const [pendingAdd, setPendingAdd] = useState<{ kind: "product"; value: PaletteProduct } | { kind: "service"; value: CatalogService } | null>(null);
  const [pickedAreaId, setPickedAreaId] = useState("");

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["quote-quick-editor-products"],
    staleTime: 60_000,
    queryFn: async () => {
      const allowPromise = fetchVisualCatalogAllowlist();
      const { data, error } = await liveProductsQuery()
        .select(
          "id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, ai_sales_description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, pipe_liquid, pipe_gas, is_material_favorite, pack_qty, default_markup_percent, btu_rating, pdf_upload_id, search_tags, suppliers(name, supplier_type)",
        )
        .or("archived.is.null,archived.eq.false")
        .limit(2000);
      if (error) throw error;
      // Equipment/materials SoT: only rows still on the current Visual PDF book.
      const scoped = filterToVisualCatalog((data || []) as any[], await allowPromise);
      return scoped.map((p: any) => ({

        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
        supplier_type: p.suppliers?.supplier_type || "both",
        supplier_discount_percent: null,
        markup_percent: resolveProductMarkupPercent(p as any),
        default_markup_percent: resolveProductMarkupPercent(p as any),
        cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
      })) as PaletteProduct[];
    },
  });

  const { services: svcOrdered, masterName, refetch: refetchCatalogServices } = useCatalogServices(companyId);
  const catalogResults = useMemo(
    () => svcOrdered.filter((s) => matchesService(s, serviceTerm)),
    [svcOrdered, serviceTerm],
  );

  const onQuoteProductIds = useMemo(
    () => new Set(items.map((i) => i.product_id).filter(Boolean) as string[]),
    [items],
  );
  const onQuoteNames = useMemo(
    () => new Set(items.map((i) => (i.item_name || "").toLowerCase())),
    [items],
  );

  // Basket rows → LIVE loaded catalogue products (id, then code); off-book rows are skipped.
  const basketProducts = useMemo(() => {
    if (!pdfBasket?.length) return [] as PaletteProduct[];
    const byId = new Map(products.map((p) => [p.id, p]));
    const byCode = new Map(products.filter((p) => p.product_code).map((p) => [String(p.product_code).trim().toLowerCase(), p]));
    const out: PaletteProduct[] = [];
    const seen = new Set<string>();
    for (const b of pdfBasket) {
      const p = (b.productId && byId.get(b.productId)) || (b.productCode ? byCode.get(b.productCode.trim().toLowerCase()) : undefined);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out;
  }, [pdfBasket, products]);
  const basketIds = useMemo(() => new Set(basketProducts.map((p) => p.id)), [basketProducts]);

  const [itemFocus, setItemFocus] = useState(false);
  const emptySections = useMemo(() => {
    if (mode !== "unit" && mode !== "material" && mode !== "item" && mode !== "selected") return null;
    if (mode === "selected") {
      // Selected = PDF basket picks only; favourites stay in unit/material/item pickers.
      return basketProducts.length ? { basket: basketProducts, favs: [] } : null;
    }
    const fits = (p: PaletteProduct) => mode === "item" || (mode === "unit") === isAirConditioningProduct(p);
    const basket: PaletteProduct[] = [];
    const g = groupFavourites(favIds, products, []);
    const favs = mode === "item" ? [...g.units, ...g.materials] : mode === "unit" ? g.units : g.materials.filter(isConsumable);
    return basket.length || favs.length ? { basket, favs } : null;
  }, [mode, basketProducts, favIds, products]);

  const productResults = useMemo(() => {
    const term = productTerm.trim();
    if (term.length < 2) return [];
    const terms = term.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = products.filter((p) => (mode !== "material" || isConsumable(p)) && (
      allTermsMatchBlob(
        terms,
        `${p.product_code || ""} ${p.short_name || ""} ${p.brand || ""} ${p.product_category || ""} ${p.description || ""}`.toLowerCase(),
      ) || productMatchesTerms(p as any, term)),
    );
    const rank = (p: PaletteProduct) =>
      basketIds.has(p.id) ? 0 : isFavourite(p.id) ? 1 : onQuoteProductIds.has(p.id) ? 2 : 3;
    return matched.sort((a, b) => rank(a) - rank(b)).slice(0, 25);
  }, [productTerm, products, isFavourite, onQuoteProductIds, basketIds, mode]);

  const nextSortOrder = () => (items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0);

  const commitProduct = async (p: PaletteProduct, areaId: string, fromFavourites = false) => {
    setAdding(p.id);
    try {
      // Shared with Mandy: same line + auto piping kit for AC units.
      // Specials overlay: Yes = special cost on THIS line only (standard markup on top); catalogue untouched.
      const sp = findSpecial(p.id, p.product_code);
      let product = p;
      let add = addItem;
      if (sp) {
        const normal = Number(getEffectiveUnitPrices(p).unitCost.toFixed(2));
        if (await specialPrompt.ask(sp, normal)) {
          product = { ...p, cost_excl_vat: Number(sp.special_cost), cost_price: Number(sp.special_cost) } as PaletteProduct;
          let stamped = false;
          add = ((row: any) => {
            if (!stamped && row?.product_id === p.id) {
              stamped = true;
              return addItem({ ...row, metadata: { ...(row.metadata || {}), ...specialLineMeta(sp, normal) } });
            }
            return addItem(row);
          }) as typeof addItem;
        }
      }
      const result = await addCatalogProductToQuote({ addItem: add, product, areaId, sortOrder: nextSortOrder(), bundles, templates, liveProducts });
      if (result.line && isAcUnitLine({ item_name: result.line.item_name, item_type: result.line.item_type, metadata: result.line.metadata }, p)) onUnitAdded?.(areaId, Number(result.line.quantity) || 1);
      setProductTerm("");
      if (fromFavourites && result.line) {
        toast({ title: `Added ${p.short_name || p.product_code}` });
        if (result.notes?.length) toast({ title: "Install note", description: result.notes.join(" · ") });
      }
      onChanged?.();
      onAddedToArea?.(areaId);
      // Length item: added at 1 m — put the cursor in its metres box.
      if (result.line && isLengthProduct(p)) {
        const id = result.line.id;
        setTimeout(() => { const el = document.querySelector<HTMLInputElement>(`[data-line-qty="${id}"]`); el?.focus(); el?.select(); }, 150);
      }
      if (result.line) closeAfterAdd();
    } finally {
      setAdding(null);
    }
  };

  const commitCatalogService = async (s: CatalogService, areaId: string, fromFavourites = false) => {
    setAdding(s.id);
    try {
      await addItem({ ...baseItem(), area_id: areaId, sort_order: nextSortOrder(), ...serviceLineFields(s) } as any);
      setServiceTerm("");
      setServiceFocus(false);
      if (fromFavourites) toast({ title: `Added ${s.name}` });
      onChanged?.();
      onAddedToArea?.(areaId);
      closeAfterAdd();
    } finally {
      setAdding(null);
    }
  };

  const routeAdd = async (pending: NonNullable<typeof pendingAdd>, isUnit: boolean, fromFavourites = false) => {
    if (targetAreaId || createTargetArea) {
      const areaId = targetAreaId || (await createTargetArea?.());
      if (!areaId) return;
      if (pending.kind === "product") await commitProduct(pending.value, areaId, fromFavourites);
      else await commitCatalogService(pending.value, areaId, fromFavourites);
      return;
    }
    const itemLines = items.filter((item) => !item.parent_item_id).map((item) => {
      const product = item.product_id ? products.find((candidate) => candidate.id === item.product_id) : null;
      return {
        areaId: item.area_id,
        isUnit: isAcUnitLine(item, product),
      };
    });
    const target = decideAddTarget(areas, itemLines, isUnit);
    if (target.kind === "pick") {
      setPickedAreaId(target.defaultAreaId);
      setPendingAdd(pending);
      return;
    }
    if (target.kind === "new" && beforeCreateArea && !(await beforeCreateArea())) return;
    const areaId = target.kind === "existing" ? target.areaId : (await addArea(`Area ${areas.length + 1}`))?.id;
    if (!areaId) return;
    if (pending.kind === "product") await commitProduct(pending.value, areaId);
    else await commitCatalogService(pending.value, areaId);
  };

  const renderRow = (p: PaletteProduct) => {
    const { unitSell } = getEffectiveUnitPrices(p);
    const perM = isLengthProduct(p) ? catalogLineFields(p, 1).unit_price : null;
    const fav = isFavourite(p.id);
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
        {(() => { const sp = findSpecial(p.id, p.product_code); return sp ? <SpecialChip cost={Number(sp.special_cost)} endDate={sp.end_date} /> : null; })()}
        <span className="shrink-0 text-xs font-medium text-slate-700">{perM != null ? `${money(perM)} / m` : money(unitSell)}</span>
      </button>
    );
  };

  const addProduct = async (p: PaletteProduct, fromFavourites = false) => {
    const isUnit = isAcUnitLine(
      { item_name: p.short_name || p.product_code, item_type: "product", metadata: {} },
      p,
    );
    await guardedRouteAdd({ kind: "product", value: p }, isUnit, fromFavourites);
  };

  const addCatalogService = async (s: CatalogService) => {
    await guardedRouteAdd({ kind: "service", value: s }, false);
  };

  const guardedRouteAdd = async (pending: NonNullable<typeof pendingAdd>, isUnit: boolean, fromFavourites = false) => {
    if (addingRef.current || adding) return;
    addingRef.current = true;
    try { await routeAdd(pending, isUnit, fromFavourites); } finally { addingRef.current = false; }
  };

  const confirmPickedArea = async () => {
    const pending = pendingAdd;
    const areaId = pickedAreaId;
    if (!pending || !areaId || addingRef.current) return;
    setPendingAdd(null);
    addingRef.current = true;
    try {
      if (pending.kind === "product") await commitProduct(pending.value, areaId);
      else await commitCatalogService(pending.value, areaId);
    } finally {
      addingRef.current = false;
    }
  };

  const saveCustomService = async () => {
    const name = customName.trim().slice(0, 120);
    if (!name || !companyId) return;
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await (supabase.from("catalog_services") as any)
      .insert({ name, description: customDesc.trim().slice(0, 1000) || null, origin: "custom", owner_company_id: companyId, created_by: u.user?.id ?? null })
      .select("id, name, description, sort_order, origin, owner_company_id, is_active, search_aliases")
      .single();
    if (error) {
      toast({
        title: isCustomLimitError(error) ? `Limit reached, ask ${masterName} to add it.` : "Couldn't add service",
        description: isCustomLimitError(error) ? undefined : error.message,
        variant: "destructive",
      });
      return;
    }
    setCustomOpen(false); setCustomName(""); setCustomDesc("");
    await refetchCatalogServices();
    await addCatalogService(data as CatalogService);
  };

  const showServiceList = customOpen || serviceFocus || serviceTerm.trim().length > 0;

  return (
    <div data-testid={mode ? "area-add" : "quote-add-bar"} data-pdf-hide data-html2canvas-ignore className="print:hidden">
      {specialPrompt.dialog}
      {mode && onClose && (
        <div className="mb-1 flex justify-end">
          <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      )}
      {mode === "favourites" ? (
        <FavouritesPicker
          products={liveProducts}
          services={svcOrdered}
          busyId={adding}
          onPickProduct={(p) => addProduct(p, true)}
          onPickService={(s) => guardedRouteAdd({ kind: "service", value: s }, false, true)}
        />
      ) : (
      <div className={mode ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
        {mode !== "service" && <div className="relative">
          <Package className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={productTerm}
            onChange={(e) => setProductTerm(e.target.value)}
            onFocus={() => setItemFocus(true)}
            onBlur={() => setItemFocus(false)}
            data-area-item-search
            autoFocus={mode === "unit" || mode === "material"}
            readOnly={mode === "selected"}
            placeholder={mode === "selected" ? "Selected from PDF" : mode === "unit" ? "Search units…" : mode === "material" ? "Search materials…" : mode === "item" ? "Search model, size (12k) or name…" : "Add item from catalog…"}
            className="h-9 border-slate-200 bg-white pl-9 text-slate-800 placeholder:text-slate-400"
          />
          {loadingProducts && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
          {(mode === "selected" || mode !== "item" || itemFocus) && (productResults.length > 0 || (!productTerm.trim() && emptySections)) && (
            <ScrollArea className={`${mode === "selected" ? "relative mt-2 h-64" : `absolute ${dropdownPos}`} z-30 max-h-64 w-full rounded-md border border-slate-200 bg-white shadow-lg`}>
              <div className="divide-y divide-slate-100" onMouseDown={(e) => { if (mode === "item") e.preventDefault(); }}>
                {productResults.length > 0
                  ? productResults.map((p) => renderRow(p))
                  : emptySections && (<>
                       {emptySections.basket.length > 0 && <div className="bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Selected from PDF</div>}
                      {emptySections.basket.map((p) => renderRow(p))}
                       {emptySections.favs.length > 0 && <div className="bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Favourites</div>}
                      {emptySections.favs.map((p) => renderRow(p))}
                    </>)}
              </div>
            </ScrollArea>
          )}
        </div>}

        {(!mode || mode === "service") && <div className="relative">
          <Wrench className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={serviceTerm}
            onChange={(e) => setServiceTerm(e.target.value)}
            onFocus={() => setServiceFocus(true)}
            onBlur={() => { if (!customOpen) setServiceFocus(false); }}
            autoFocus={mode === "service"}
            placeholder="Add service…"
            className="h-9 border-slate-200 bg-white pl-9 text-slate-800 placeholder:text-slate-400"
          />
          {showServiceList && (
            <ScrollArea className={`absolute z-30 ${dropdownPos} h-72 max-h-[min(18rem,50vh)] w-full rounded-md border border-slate-200 bg-white shadow-lg`}>
              <div className="divide-y divide-slate-100" onMouseDown={(e) => e.preventDefault()}>
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Services</p>
                {catalogResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addCatalogService(s)}
                    disabled={adding === s.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{s.name}</span>
                    {s.origin === "custom" && <Badge variant="outline" className="shrink-0 text-[10px]">Custom</Badge>}
                  </button>
                ))}
                {customOpen ? (
                  <div className="space-y-2 p-3">
                    <Input value={customName} maxLength={120} onChange={(e) => setCustomName(e.target.value)} placeholder="Service name" className="h-8" />
                    <Input value={customDesc} maxLength={1000} onChange={(e) => setCustomDesc(e.target.value)} placeholder="Description" className="h-8" />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setCustomOpen(false)}>Cancel</Button>
                      <Button type="button" size="sm" onClick={() => void saveCustomService()} disabled={!customName.trim()}>Add</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setCustomOpen(true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50">
                    <Plus className="h-3.5 w-3.5 shrink-0" /> Add custom service
                  </button>
                )}
              </div>
            </ScrollArea>
          )}
        </div>}
      </div>
      )}
      <Dialog open={!!pendingAdd} onOpenChange={(open) => { if (!open && !adding) setPendingAdd(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Which area?</DialogTitle>
            <DialogDescription>Choose where to add this item. The last area is selected by default.</DialogDescription>
          </DialogHeader>
          <Select value={pickedAreaId} onValueChange={setPickedAreaId}>
            <SelectTrigger aria-label="Area"><SelectValue placeholder="Choose an area" /></SelectTrigger>
            <SelectContent>
              {areas.map((area) => <SelectItem key={area.id} value={area.id}>{area.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingAdd(null)} disabled={!!adding}>Cancel</Button>
            <Button type="button" onClick={() => void confirmPickedArea()} disabled={!pickedAreaId || !!adding}>Add to area</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

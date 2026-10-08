/**
 * QuoteContext — single source of truth for all three quote builders.
 * Wraps Supabase CRUD + realtime subscriptions for quotes, quote_areas, quote_items.
 *
 * Orphaned quotes audit (run in DB to find quotes without an associated customer):
 *   SELECT id, quote_number, status, created_at, company_id
 *   FROM quotes WHERE customer_id IS NULL ORDER BY created_at DESC;
 */


import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type {
  QuoteMeta, QuoteArea, QuoteItem,
  QuoteItemInsert, QuoteItemUpdate,
  QuoteAreaInsert, QuoteAreaUpdate,
} from "@/types/quote";
import { needsDefaultArea, getDefaultAreaName } from "@/utils/quoteTransformers";
import { DEFAULT_CATEGORY_MARKUPS, setActiveQuoteMarkupRates, setActiveMaterialsWastePercent, DEFAULT_MATERIALS_WASTE_PERCENT, type CategoryMarkupRates } from "@/lib/pricing";
import { metrePriceFromPackPerMetre } from "@/lib/priceGuard";
import { isJobLabour, normalizeLabourMode, planLabourInsert, syncAutoLabour, countAcUnits } from "@/lib/areaLabour";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { isLabourItem } from "@/lib/labour";
import { runSerialPerQuote } from "@/utils/persistQuoteFromBaskets";

/* ────────────────── Types ────────────────── */

/* ── Pending-write tracker (estimate page "Saving…" + leave guard) ── */
let pendingWritesGlobal = 0;
const pendingListeners = new Set<(n: number) => void>();
function bumpPending(delta: number) {
  pendingWritesGlobal = Math.max(0, pendingWritesGlobal + delta);
  pendingListeners.forEach((fn) => fn(pendingWritesGlobal));
}
export function subscribePendingWrites(fn: (n: number) => void) {
  pendingListeners.add(fn);
  return () => { pendingListeners.delete(fn); };
}
export function getPendingWrites() { return pendingWritesGlobal; }
export function usePendingQuoteWrites() {
  const [n, setN] = useState(pendingWritesGlobal);
  useEffect(() => subscribePendingWrites(setN), []);
  return n;
}
/** Resolve true once all writes finish, false on timeout. */
export function waitForQuoteWrites(timeoutMs = 5000): Promise<boolean> {
  if (pendingWritesGlobal === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => { off(); resolve(false); }, timeoutMs);
    const off = subscribePendingWrites((n) => { if (n === 0) { clearTimeout(t); off(); resolve(true); } });
  });
}
export async function trackQuoteWrite<T>(p: PromiseLike<T>): Promise<T> { return track(p); }
async function track<T>(p: PromiseLike<T>): Promise<T> {
  bumpPending(1);
  try { return await p; } finally { bumpPending(-1); }
}

interface QuoteContextValue {
  quoteId: string;
  pendingWrites: number;
  meta: QuoteMeta | null;
  areas: QuoteArea[];
  items: QuoteItem[];
  loading: boolean;
  error: string | null;
  canSave: boolean;

  // Quote meta
  updateQuote: (patch: Partial<Pick<QuoteMeta, "customer_id" | "customer_name" | "notes" | "status" | "discount_type" | "discount_value" | "terms_text" | "reference_text">>) => Promise<void>;

  // Areas
  addArea: (name: string) => Promise<QuoteArea | null>;
  updateArea: (id: string, patch: QuoteAreaUpdate) => Promise<boolean>;
  deleteArea: (id: string) => Promise<boolean>;
  reorderAreas: (orderedIds: string[]) => Promise<void>;

  // Items
  addItem: (item: Omit<QuoteItemInsert, "quote_id">) => Promise<QuoteItem | null>;
  updateItem: (id: string, patch: QuoteItemUpdate) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  moveItemToArea: (itemId: string, areaId: string | null) => Promise<boolean>;

  // Helpers
  ensureDefaultArea: () => Promise<QuoteArea | null>;
  getItemsByArea: (areaId: string | null) => QuoteItem[];
  getBundleChildren: (parentId: string) => QuoteItem[];

  // Category markups (Units % / Materials %): quote override > company default
  markupRates: CategoryMarkupRates;
  companyMarkupRates: CategoryMarkupRates;
  setMarkupRates: (rates: CategoryMarkupRates) => Promise<void>;
  /** Active waste % for length items: quote override ?? company ?? 10. */
  wastePercent: number;
  setWastePercent: (pct: number | null) => Promise<void>;

  /** Silent re-read of quote/areas/items; returns the fresh rows (null on failure). */
  refetch: () => Promise<{ areas: QuoteArea[]; items: QuoteItem[] } | null>;
}

const QuoteContext = createContext<QuoteContextValue | null>(null);

/** Same as useQuoteContext but returns null outside a QuoteProvider. */
export function useOptionalQuoteContext() {
  return useContext(QuoteContext);
}

export function useQuoteContext() {
  const ctx = useContext(QuoteContext);
  if (!ctx) throw new Error("useQuoteContext must be used within <QuoteProvider>");
  return ctx;
}

/* ────────────────── Helpers ────────────────── */

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";

const revert = (fn: () => Promise<unknown>) => {
  void fn().catch((err) => console.error("QuoteContext revert failed:", err));
};

type RowWithId = { id: string };

/* ────────────────── Provider ────────────────── */

export function QuoteProvider({ quoteId, children }: { quoteId: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [meta, setMeta] = useState<QuoteMeta | null>(null);
  const [areas, setAreasState] = useState<QuoteArea[]>([]);
  const [items, setItemsState] = useState<QuoteItem[]>([]);
  const { settings: labourSettings } = useCompanySettings();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const itemsRef = useRef<QuoteItem[]>([]);
  const setItems = useCallback((value: React.SetStateAction<QuoteItem[]>) => {
    const next = typeof value === "function" ? value(itemsRef.current) : value;
    itemsRef.current = next;
    setItemsState(next);
  }, []);
  const areasRef = useRef<QuoteArea[]>([]);
  const setAreas = useCallback((value: React.SetStateAction<QuoteArea[]>) => {
    const next = typeof value === "function" ? value(areasRef.current) : value;
    areasRef.current = next;
    setAreasState(next);
  }, []);
  const fetchSeqRef = useRef(0);
  const ensuringRef = useRef<Promise<QuoteArea | null> | null>(null);
  // Tracks optimistic ids created locally so realtime INSERTs for the same id are deduped
  const optimisticIdsRef = useRef<Set<string>>(new Set());


  /* ── Fetch ── */
  const fetchAll = useCallback(async (silent = false): Promise<{ areas: QuoteArea[]; items: QuoteItem[] } | null> => {
    const seq = ++fetchSeqRef.current;
    try {
      if (!silent) setLoading(true);
      const [quoteRes, areasRes, itemsRes] = await Promise.all([
        supabase.from("quotes").select("id, quote_number, customer_id, customer_name, status, subtotal, vat_rate, vat_amount, total, notes, valid_until, discount_type, discount_value, terms_text, reference_text, company_id, units_markup_percent, materials_markup_percent, materials_waste_percent, labour_mode").eq("id", quoteId).single(),
        supabase.from("quote_areas").select("*").eq("quote_id", quoteId).order("sort_order"),
        supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order"),
      ]);

      if (!mountedRef.current) return null;
      // Drop stale results if a newer fetch started or realtime is now the source of truth
      if (seq !== fetchSeqRef.current) return null;

      if (quoteRes.error) throw quoteRes.error;
      if (areasRes.error) throw areasRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setMeta(quoteRes.data as unknown as QuoteMeta);
      setAreas((areasRes.data || []) as unknown as QuoteArea[]);
      setItems((itemsRes.data || []) as unknown as QuoteItem[]);
      setError(null);
      return { areas: (areasRes.data || []) as unknown as QuoteArea[], items: (itemsRes.data || []) as unknown as QuoteItem[] };
    } catch (e: unknown) {
      console.error("QuoteContext fetch error:", e);
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setError(errMsg(e) || "Failed to load quote");
      }
      return null;
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) setLoading(false);
    }
  }, [quoteId, userId]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchAll();
    return () => { mountedRef.current = false; };
  }, [fetchAll]);

  /* ── Realtime subscriptions ── */
  useEffect(() => {
    const channel = supabase
      .channel(`quote-sync-${quoteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes", filter: `id=eq.${quoteId}` }, (payload) => {
        if (payload.eventType === "UPDATE" && payload.new) {
          setMeta(payload.new as unknown as QuoteMeta);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_areas", filter: `quote_id=eq.${quoteId}` }, (payload) => {
        if (payload.eventType === "INSERT" && payload.new) {
          const row = payload.new as unknown as QuoteArea & RowWithId;
          if (optimisticIdsRef.current.has(row.id)) return;
          setAreas((prev) => {
            if (prev.find((a) => a.id === row.id)) return prev;
            return [...prev, row].sort((a, b) => a.sort_order - b.sort_order);
          });
        } else if (payload.eventType === "UPDATE" && payload.new) {
          const row = payload.new as unknown as QuoteArea & RowWithId;
          setAreas((prev) => prev.map((a) => a.id === row.id ? row : a));
        } else if (payload.eventType === "DELETE" && payload.old) {
          const row = payload.old as RowWithId;
          setAreas((prev) => prev.filter((a) => a.id !== row.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_items", filter: `quote_id=eq.${quoteId}` }, (payload) => {
        if (payload.eventType === "INSERT" && payload.new) {
          const row = payload.new as unknown as QuoteItem & RowWithId;
          if (optimisticIdsRef.current.has(row.id)) return;
          setItems((prev) => {
            if (prev.find((i) => i.id === row.id)) return prev;
            return [...prev, row].sort((a, b) => a.sort_order - b.sort_order);
          });
        } else if (payload.eventType === "UPDATE" && payload.new) {
          const row = payload.new as unknown as QuoteItem & RowWithId;
          setItems((prev) => prev.map((i) => i.id === row.id ? row : i));
        } else if (payload.eventType === "DELETE" && payload.old) {
          const row = payload.old as RowWithId;
          setItems((prev) => prev.filter((i) => i.id !== row.id));
        }
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [quoteId, userId]);

  /* ── Derived ── */
  const canSave = !!meta?.customer_id;

  /* ── Category markup rates ── */
  const [companyMarkupRates, setCompanyMarkupRates] = useState<CategoryMarkupRates>(DEFAULT_CATEGORY_MARKUPS);
  const [companyWaste, setCompanyWaste] = useState<number>(DEFAULT_MATERIALS_WASTE_PERCENT);
  const [repriceSeq, setRepriceSeq] = useState(0);
  const companyId = meta?.company_id ?? null;
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void (supabase.from("companies") as any)
      .select("units_markup_percent, materials_markup_percent, materials_waste_percent")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data }: { data: { units_markup_percent: number | null; materials_markup_percent: number | null; materials_waste_percent?: number | null } | null }) => {
        if (cancelled || !data) return;
        setCompanyWaste(Number(data.materials_waste_percent ?? DEFAULT_MATERIALS_WASTE_PERCENT));
        setCompanyMarkupRates({
          units: Number(data.units_markup_percent ?? DEFAULT_CATEGORY_MARKUPS.units),
          materials: Number(data.materials_markup_percent ?? DEFAULT_CATEGORY_MARKUPS.materials),
        });
      });
    return () => { cancelled = true; };
  }, [companyId]);

  const markupRates = useMemo<CategoryMarkupRates>(() => ({
    units: meta?.units_markup_percent != null ? Number(meta.units_markup_percent) : companyMarkupRates.units,
    materials: meta?.materials_markup_percent != null ? Number(meta.materials_markup_percent) : companyMarkupRates.materials,
  }), [meta?.units_markup_percent, meta?.materials_markup_percent, companyMarkupRates]);

  // Publish the open quote's rates to the pricing engine (new lines use them).
  // Loading never reprices saved lines — only setMarkupRates flags an edit.
  useEffect(() => {
    if (!meta) return;
    setActiveQuoteMarkupRates(markupRates);
  }, [meta, markupRates]);
  useEffect(() => () => setActiveQuoteMarkupRates(null), []);
  const wastePercent = (meta as any)?.materials_waste_percent != null ? Number((meta as any).materials_waste_percent) : companyWaste;
  useEffect(() => { setActiveMaterialsWastePercent(wastePercent); }, [wastePercent]);
  useEffect(() => () => setActiveMaterialsWastePercent(null), []);
  const setWastePercent = useCallback(async (pct: number | null) => {
    const v = pct == null ? null : Math.max(0, Math.min(50, Number(pct) || 0));
    setMeta((prev) => prev ? ({ ...prev, materials_waste_percent: v } as any) : prev);
    setActiveMaterialsWastePercent(v ?? companyWaste);
    setRepriceSeq((n) => n + 1);
    const { error } = await track((supabase.from("quotes") as any).update({ materials_waste_percent: v }).eq("id", quoteId));
    if (error) toast({ title: "Couldn't save waste %", description: error.message, variant: "destructive" });
  }, [quoteId, companyWaste]);

  const setMarkupRates = useCallback(async (rates: CategoryMarkupRates) => {
    const clean = {
      units_markup_percent: Math.max(-50, Math.min(500, Number(rates.units) || 0)),
      materials_markup_percent: Math.max(-50, Math.min(500, Number(rates.materials) || 0)),
    };
    setMeta((prev) => prev ? { ...prev, ...clean } : prev);
    setActiveQuoteMarkupRates({ units: clean.units_markup_percent, materials: clean.materials_markup_percent }, true);
    setRepriceSeq((n) => n + 1);
    const { error } = await track(supabase.from("quotes").update(clean as TablesUpdate<"quotes">).eq("id", quoteId));
    if (error) toast({ title: "Couldn't save markup %", description: error.message, variant: "destructive" });
  }, [quoteId]);

  /* ── Quote meta ── */
  const updateQuote = useCallback(async (patch: Partial<Pick<QuoteMeta, "customer_id" | "customer_name" | "notes" | "status" | "discount_type" | "discount_value" | "terms_text" | "reference_text">>) => {
    // Hard guard: never null out customer_id, and never persist a non-draft status without one.
    if ("customer_id" in patch && !patch.customer_id) {
      throw new Error("A client must be associated with the quote before saving.");
    }
    const resultingCustomerId = patch.customer_id ?? meta?.customer_id ?? null;
    if (patch.status && patch.status !== "draft" && !resultingCustomerId) {
      throw new Error("A client must be associated with the quote before saving.");
    }
    let wasNullCustomer = false;
    if (mountedRef.current) {
      setMeta((prev) => {
        if (prev && !prev.customer_id) wasNullCustomer = true;
        return prev ? { ...prev, ...patch } : prev;
      });
    }
    const { error } = await track(supabase
      .from("quotes")
      .update(patch as TablesUpdate<"quotes">)
      .eq("id", quoteId));
    if (!mountedRef.current) return;
    if (error) {
      toast({ title: "Error updating quote", description: error.message, variant: "destructive" });
      revert(fetchAll);
      return;
    }
    if (wasNullCustomer && patch.customer_id) {
      const { data: refreshed, error: refErr } = await supabase
        .from("quotes")
        .select("quote_number")
        .eq("id", quoteId)
        .single();
      if (!mountedRef.current) return;
      if (refErr) {
        console.error("QuoteContext refresh quote_number error:", refErr);
        return;
      }
      if (refreshed?.quote_number && mountedRef.current) {
        setMeta((prev) => prev ? { ...prev, quote_number: refreshed.quote_number } : prev);
      }
    }
  }, [quoteId, fetchAll]);

  /* ── Areas ── */
  const addArea = useCallback(async (name: string): Promise<QuoteArea | null> => {
    const nextOrder = areasRef.current.length;
    const optimisticId = crypto.randomUUID();
    const optimistic: QuoteArea = {
      id: optimisticId,
      quote_id: quoteId,
      name,
      sort_order: nextOrder,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    optimisticIdsRef.current.add(optimisticId);
    setAreas((prev) => [...prev, optimistic]);

    const { data, error } = await track(supabase
      .from("quote_areas")
      .insert({ id: optimisticId, quote_id: quoteId, name, sort_order: nextOrder } as TablesInsert<"quote_areas">)
      .select()
      .single());

    if (!mountedRef.current) {
      optimisticIdsRef.current.delete(optimisticId);
      return null;
    }
    if (error) {
      toast({ title: "Error adding area", description: error.message, variant: "destructive" });
      setAreas((prev) => prev.filter((a) => a.id !== optimisticId));
      optimisticIdsRef.current.delete(optimisticId);
      return null;
    }
    const real = data as unknown as QuoteArea;
    setAreas((prev) => prev.map((a) => a.id === optimisticId ? real : a));
    // Keep id in the dedupe set briefly to swallow any late realtime INSERT
    setTimeout(() => optimisticIdsRef.current.delete(optimisticId), 5000);
    return real;
  }, [quoteId]);

  const updateArea = useCallback(async (id: string, patch: QuoteAreaUpdate) => {
    setAreas((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } as QuoteArea : a));
    const res = await track(supabase
      .from("quote_areas")
      .update(patch as TablesUpdate<"quote_areas">)
      .eq("id", id).select("id"));
    const error = res.error || (!res.data?.length ? { message: "Nothing was saved (no access, or the row is gone)." } : null);
    if (!mountedRef.current) return !error;
    if (error) {
      toast({ title: "Error updating area", description: error.message, variant: "destructive" });
      revert(fetchAll);
      return false;
    }
    return true;
  }, [fetchAll]);

  const deleteArea = useCallback(async (id: string) => {
    setAreas((prev) => prev.filter((a) => a.id !== id));
    setItems((prev) => prev.filter((i) => i.area_id !== id));
    const res = await track(supabase.from("quote_areas").delete().eq("id", id).select("id"));
    const error = res.error || (!res.data?.length ? { message: "Nothing was saved (no access, or the row is gone)." } : null);
    if (!mountedRef.current) return !error;
    if (error) {
      toast({ title: "Error deleting area", description: error.message, variant: "destructive" });
      revert(fetchAll);
      return false;
    }
    return true;
  }, [fetchAll]);

  const reorderAreas = useCallback(async (orderedIds: string[]) => {
    setAreas((prev) => {
      const map = new Map(prev.map((a) => [a.id, a]));
      return orderedIds.map((id, i) => ({ ...map.get(id)!, sort_order: i }));
    });
    const results = await track(Promise.all(
      orderedIds.map((id, i) =>
        supabase.from("quote_areas").update({ sort_order: i } as TablesUpdate<"quote_areas">).eq("id", id)
      )
    ));
    if (!mountedRef.current) return;
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      toast({ title: "Error reordering areas", description: firstErr.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  /* ── Items ── */
  const reconcileLabour = useCallback(async () => {
    const run = track(runSerialPerQuote(quoteId, async () => {
      const check = async (request: any) => {
        const res = await track<any>(request.select().single());
        if (res.error || !res.data) throw new Error(res.error?.message || "Labour was not saved.");
        return res.data as QuoteItem;
      };
      await syncAutoLabour(itemsRef.current, areasRef.current, normalizeLabourMode(meta?.labour_mode), labourSettings.default_install_labour_hours, labourSettings.default_hourly_rate, {
        add: async (row) => {
          const id = crypto.randomUUID();
          optimisticIdsRef.current.add(id);
          const saved = await check(supabase.from("quote_items").insert({ ...row, id, quote_id: quoteId, sort_order: itemsRef.current.length, source: "labour" }));
          setItems((prev) => [...prev.filter((i) => i.id !== id), saved]);
        },
        update: async (id, row) => {
          const saved = await check(supabase.from("quote_items").update(row).eq("id", id));
          setItems((prev) => prev.map((i) => i.id === id ? saved : i));
        },
        remove: async (id) => {
          await check(supabase.from("quote_items").delete().eq("id", id));
          setItems((prev) => prev.filter((i) => i.id !== id));
        },
      });
    }));
    try { await run; } catch (e) {
      toast({ title: "Could not update automatic labour", description: errMsg(e), variant: "destructive" });
      await fetchAll(true);
      throw e;
    }
  }, [quoteId, meta?.labour_mode, labourSettings.default_install_labour_hours, labourSettings.default_hourly_rate, fetchAll, setItems]);

  const addItem = useCallback(async (item0: Omit<QuoteItemInsert, "quote_id">): Promise<QuoteItem | null> => {
    if (isLabourItem(item0) && item0.metadata?.labour_auto === true) {
      await reconcileLabour();
      return itemsRef.current.find((i) => isLabourItem(i) && (normalizeLabourMode(meta?.labour_mode) === "job" ? isJobLabour(i) : i.area_id === item0.area_id)) ?? null;
    }
    // Job labour mode: one job labour line. A labour insert merges into it (every caller, incl. Mandy, lands here).
    const plan = planLabourInsert(normalizeLabourMode(meta?.labour_mode), itemsRef.current, item0);
    if (plan.kind === "merge") {
      const before = itemsRef.current.find((i) => i.id === plan.id);
      setItems((prev) => prev.map((i) => i.id === plan.id ? { ...i, ...plan.patch } as QuoteItem : i));
      const res = await track(supabase.from("quote_items").update(plan.patch as TablesUpdate<"quote_items">).eq("id", plan.id).select().single());
      if (!mountedRef.current) return null;
      if (res.error || !res.data) {
        toast({ title: "Error adding labour", description: res.error?.message || "Nothing was saved.", variant: "destructive" });
        if (before) setItems((prev) => prev.map((i) => i.id === plan.id ? before : i));
        return null;
      }
      const merged = res.data as unknown as QuoteItem;
      setItems((prev) => prev.map((i) => i.id === plan.id ? merged : i));
      return merged;
    }
    const item = plan.row as Omit<QuoteItemInsert, "quote_id">;
    const optimisticId = item.id || crypto.randomUUID();
    const insertData = { ...item, id: optimisticId, quote_id: quoteId };
    const optimistic: QuoteItem = {
      ...insertData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as QuoteItem;
    optimisticIdsRef.current.add(optimisticId);
    setItems((prev) => [...prev, optimistic].sort((a, b) => a.sort_order - b.sort_order));

    const { data, error } = await track(supabase
      .from("quote_items")
      .insert(insertData as unknown as TablesInsert<"quote_items">)
      .select()
      .single());

    if (!mountedRef.current) {
      optimisticIdsRef.current.delete(optimisticId);
      return null;
    }
    if (error) {
      toast({ title: "Error adding item", description: error.message, variant: "destructive" });
      setItems((prev) => prev.filter((i) => i.id !== optimisticId));
      optimisticIdsRef.current.delete(optimisticId);
      return null;
    }
    const real = data as unknown as QuoteItem;
    setItems((prev) => prev.map((i) => i.id === optimisticId ? real : i));
    setTimeout(() => optimisticIdsRef.current.delete(optimisticId), 5000);
    if (countAcUnits([real]) > 0) await reconcileLabour();
    return real;
  }, [quoteId, meta?.labour_mode, reconcileLabour]);

  const updateItem = useCallback(async (id: string, patch: QuoteItemUpdate) => {
    const before = itemsRef.current.find((i) => i.id === id);
    // Legacy add callbacks must not apply a second click-delta after unit CRUD reconciled it.
    if (before && isLabourItem(before) && patch.metadata?.labour_auto === true) {
      await reconcileLabour();
      return true;
    }
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } as QuoteItem : i));
    const res = await track(supabase
      .from("quote_items")
      .update(patch as TablesUpdate<"quote_items">)
      .eq("id", id).select("id"));
    const error = res.error || (!res.data?.length ? { message: "Nothing was saved (no access, or the row is gone)." } : null);
    if (!mountedRef.current) return !error;
    if (error) {
      toast({ title: "Error updating item", description: error.message, variant: "destructive" });
      revert(fetchAll);
      return false;
    }
    if (before && (countAcUnits([before]) > 0 || countAcUnits([{ ...before, ...patch }]) > 0) && (patch.quantity != null || patch.area_id !== undefined || patch.product_id !== undefined || patch.item_name !== undefined)) await reconcileLabour();
    return true;
  }, [fetchAll, reconcileLabour]);

  const deleteItem = useCallback(async (id: string) => {
    const before = itemsRef.current.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_item_id !== id));
    const res = await track(supabase.from("quote_items").delete().eq("id", id).select("id"));
    const error = res.error || (!res.data?.length ? { message: "Nothing was saved (no access, or the row is gone)." } : null);
    if (!mountedRef.current) return !error;
    if (error) {
      toast({ title: "Error deleting item", description: error.message, variant: "destructive" });
      revert(fetchAll);
      return false;
    }
    if (before && countAcUnits([before]) > 0) await reconcileLabour();
    return true;
  }, [fetchAll, reconcileLabour]);

  const moveItemToArea = useCallback(async (itemId: string, areaId: string | null) => {
    const before = itemsRef.current.find((i) => i.id === itemId);
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, area_id: areaId } : i));
    const res = await track(supabase
      .from("quote_items")
      .update({ area_id: areaId } as TablesUpdate<"quote_items">)
      .eq("id", itemId).select("id"));
    const error = res.error || (!res.data?.length ? { message: "Nothing was saved (no access, or the row is gone)." } : null);
    if (!mountedRef.current) return !error;
    if (error) {
      toast({ title: "Error moving item", description: error.message, variant: "destructive" });
      revert(fetchAll);
      return false;
    }
    if (before && countAcUnits([before]) > 0) await reconcileLabour();
    return true;
  }, [fetchAll, reconcileLabour]);

  /* ── Helpers ── */
  const ensureDefaultArea = useCallback(async (): Promise<QuoteArea | null> => {
    // Coalesce concurrent callers so we never create two "General" areas
    if (ensuringRef.current) return ensuringRef.current;

    const run = (async (): Promise<QuoteArea | null> => {
      const currentItems = itemsRef.current;
      const currentAreas = areasRef.current;
      if (!needsDefaultArea(currentItems, currentAreas)) {
        if (currentAreas.length > 0) {
          const orphans = currentItems.filter((i) => !i.area_id && !i.parent_item_id && !isJobLabour(i as any));
          if (orphans.length > 0) {
            const defaultArea = currentAreas[0];
            const results = await track(Promise.all(orphans.map((i) =>
              supabase
                .from("quote_items")
                .update({ area_id: defaultArea.id } as TablesUpdate<"quote_items">)
                .eq("id", i.id)
            )));
            if (!mountedRef.current) return defaultArea;
            const firstErr = results.find((r) => r.error)?.error;
            if (firstErr) {
              toast({ title: "Error assigning items to area", description: firstErr.message, variant: "destructive" });
              revert(fetchAll);
            } else {
              setItems((prev) => prev.map((i) =>
                !i.area_id && !i.parent_item_id && !isJobLabour(i as any) ? { ...i, area_id: defaultArea.id } : i
              ));
            }
          }
          return currentAreas[0];
        }
        return currentAreas[0] || null;
      }
      const area = await addArea(getDefaultAreaName());
      if (area && mountedRef.current) {
        const orphans = itemsRef.current.filter((i) => !i.area_id && !i.parent_item_id && !isJobLabour(i as any));
        if (orphans.length > 0) {
          const results = await track(Promise.all(orphans.map((i) =>
            supabase
              .from("quote_items")
              .update({ area_id: area.id } as TablesUpdate<"quote_items">)
              .eq("id", i.id)
          )));
          if (!mountedRef.current) return area;
          const firstErr = results.find((r) => r.error)?.error;
          if (firstErr) {
            toast({ title: "Error assigning items to area", description: firstErr.message, variant: "destructive" });
            revert(fetchAll);
          } else {
            setItems((prev) => prev.map((i) =>
              !i.area_id && !i.parent_item_id && !isJobLabour(i as any) ? { ...i, area_id: area.id } : i
            ));
          }
        }
      }
      return area;
    })();

    ensuringRef.current = run;
    try {
      return await run;
    } finally {
      ensuringRef.current = null;
    }
  }, [addArea, fetchAll]);

  const getItemsByArea = useCallback((areaId: string | null): QuoteItem[] => {
    return items
      .filter((i) => !i.parent_item_id && (areaId ? i.area_id === areaId : !i.area_id))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [items]);

  const getBundleChildrenFn = useCallback((parentId: string): QuoteItem[] => {
    return items
      .filter((i) => i.parent_item_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [items]);

  const pendingWrites = usePendingQuoteWrites();
  // Materials % / waste % edited → reprice waste-priced metre lines through the same helper (manual prices kept).
  const lastRepriceRef = useRef(0);
  useEffect(() => {
    if (repriceSeq === lastRepriceRef.current) return;
    lastRepriceRef.current = repriceSeq;
    for (const i of itemsRef.current) {
      const md: any = i.metadata || {};
      if (md.qty_unit !== "metre" || md.waste_percent == null || md.manual_price) continue;
      const L = Number(md.supplier_length_m), pack = Number(md.pack_cost_ex_vat);
      if (!(L > 0) || !(pack > 0)) continue;
      const { costPerM, sellPerM } = metrePriceFromPackPerMetre(pack / L, wastePercent, markupRates.materials);
      if (sellPerM === Number(i.unit_price) && costPerM === Number(md.unit_cost)) continue;
      void updateItem(i.id, {
        unit_price: sellPerM, total_price: Math.round((Number(i.quantity) || 0) * sellPerM * 100 + 1e-9) / 100,
        metadata: { ...md, unit_cost: costPerM, cost_excl: costPerM, markup_percent: markupRates.materials, waste_percent: wastePercent },
      } as any);
    }
  }, [repriceSeq, wastePercent, markupRates.materials, updateItem]);

  const value: QuoteContextValue = useMemo(() => ({
    quoteId,
    pendingWrites,
    meta,
    areas,
    items,
    loading,
    error,
    canSave,
    updateQuote,
    addArea,
    updateArea,
    deleteArea,
    reorderAreas,
    addItem,
    updateItem,
    deleteItem,
    moveItemToArea,
    ensureDefaultArea,
    getItemsByArea,
    getBundleChildren: getBundleChildrenFn,
    markupRates,
    companyMarkupRates,
    setMarkupRates,
    wastePercent,
    setWastePercent,
    refetch: () => fetchAll(true),
  }), [pendingWrites, fetchAll, markupRates, companyMarkupRates, setMarkupRates, wastePercent, setWastePercent, quoteId, meta, areas, items, loading, error, canSave, updateQuote, addArea, updateArea, deleteArea, reorderAreas, addItem, updateItem, deleteItem, moveItemToArea, ensureDefaultArea, getItemsByArea, getBundleChildrenFn]);

  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

export default QuoteContext;

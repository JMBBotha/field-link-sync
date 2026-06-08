/**
 * QuoteContext — single source of truth for all three quote builders.
 * Wraps Supabase CRUD + realtime subscriptions for quotes, quote_areas, quote_items.
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

/* ────────────────── Types ────────────────── */

interface QuoteContextValue {
  quoteId: string;
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
  updateArea: (id: string, patch: QuoteAreaUpdate) => Promise<void>;
  deleteArea: (id: string) => Promise<void>;
  reorderAreas: (orderedIds: string[]) => Promise<void>;

  // Items
  addItem: (item: Omit<QuoteItemInsert, "quote_id">) => Promise<QuoteItem | null>;
  updateItem: (id: string, patch: QuoteItemUpdate) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  moveItemToArea: (itemId: string, areaId: string | null) => Promise<void>;

  // Helpers
  ensureDefaultArea: () => Promise<QuoteArea | null>;
  getItemsByArea: (areaId: string | null) => QuoteItem[];
  getBundleChildren: (parentId: string) => QuoteItem[];
}

const QuoteContext = createContext<QuoteContextValue | null>(null);

export function useQuoteContext() {
  const ctx = useContext(QuoteContext);
  if (!ctx) throw new Error("useQuoteContext must be used within <QuoteProvider>");
  return ctx;
}

/* ────────────────── Helpers ────────────────── */

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";

const revert = (fn: () => Promise<void>) => {
  void fn().catch((err) => console.error("QuoteContext revert failed:", err));
};

type RowWithId = { id: string };

/* ────────────────── Provider ────────────────── */

export function QuoteProvider({ quoteId, children }: { quoteId: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [meta, setMeta] = useState<QuoteMeta | null>(null);
  const [areas, setAreas] = useState<QuoteArea[]>([]);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const itemsRef = useRef<QuoteItem[]>([]);
  const areasRef = useRef<QuoteArea[]>([]);
  const fetchSeqRef = useRef(0);
  const ensuringRef = useRef<Promise<QuoteArea | null> | null>(null);
  // Tracks optimistic ids created locally so realtime INSERTs for the same id are deduped
  const optimisticIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { areasRef.current = areas; }, [areas]);

  /* ── Fetch ── */
  const fetchAll = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      const [quoteRes, areasRes, itemsRes] = await Promise.all([
        supabase.from("quotes").select("id, quote_number, customer_id, customer_name, status, subtotal, vat_rate, vat_amount, total, notes, valid_until, discount_type, discount_value, terms_text, reference_text").eq("id", quoteId).single(),
        supabase.from("quote_areas").select("*").eq("quote_id", quoteId).order("sort_order"),
        supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order"),
      ]);

      if (!mountedRef.current) return;
      // Drop stale results if a newer fetch started or realtime is now the source of truth
      if (seq !== fetchSeqRef.current) return;

      if (quoteRes.error) throw quoteRes.error;
      if (areasRes.error) throw areasRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setMeta(quoteRes.data as unknown as QuoteMeta);
      setAreas((areasRes.data || []) as unknown as QuoteArea[]);
      setItems((itemsRes.data || []) as unknown as QuoteItem[]);
      setError(null);
    } catch (e: unknown) {
      console.error("QuoteContext fetch error:", e);
      if (mountedRef.current && seq === fetchSeqRef.current) {
        setError(errMsg(e) || "Failed to load quote");
      }
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

  /* ── Quote meta ── */
  const updateQuote = useCallback(async (patch: Partial<Pick<QuoteMeta, "customer_id" | "customer_name" | "notes" | "status" | "discount_type" | "discount_value" | "terms_text" | "reference_text">>) => {
    let wasNullCustomer = false;
    setMeta((prev) => {
      if (prev && !prev.customer_id) wasNullCustomer = true;
      return prev ? { ...prev, ...patch } : prev;
    });
    const { error } = await supabase
      .from("quotes")
      .update(patch as TablesUpdate<"quotes">)
      .eq("id", quoteId);
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
      if (refreshed?.quote_number) {
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

    const { data, error } = await supabase
      .from("quote_areas")
      .insert({ id: optimisticId, quote_id: quoteId, name, sort_order: nextOrder } as TablesInsert<"quote_areas">)
      .select()
      .single();

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
    const { error } = await supabase
      .from("quote_areas")
      .update(patch as TablesUpdate<"quote_areas">)
      .eq("id", id);
    if (!mountedRef.current) return;
    if (error) {
      toast({ title: "Error updating area", description: error.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  const deleteArea = useCallback(async (id: string) => {
    setAreas((prev) => prev.filter((a) => a.id !== id));
    setItems((prev) => prev.map((i) => i.area_id === id ? { ...i, area_id: null } : i));
    const { error } = await supabase.from("quote_areas").delete().eq("id", id);
    if (!mountedRef.current) return;
    if (error) {
      toast({ title: "Error deleting area", description: error.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  const reorderAreas = useCallback(async (orderedIds: string[]) => {
    setAreas((prev) => {
      const map = new Map(prev.map((a) => [a.id, a]));
      return orderedIds.map((id, i) => ({ ...map.get(id)!, sort_order: i }));
    });
    const results = await Promise.all(
      orderedIds.map((id, i) =>
        supabase.from("quote_areas").update({ sort_order: i } as TablesUpdate<"quote_areas">).eq("id", id)
      )
    );
    if (!mountedRef.current) return;
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      toast({ title: "Error reordering areas", description: firstErr.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  /* ── Items ── */
  const addItem = useCallback(async (item: Omit<QuoteItemInsert, "quote_id">): Promise<QuoteItem | null> => {
    const optimisticId = item.id || crypto.randomUUID();
    const insertData = { ...item, id: optimisticId, quote_id: quoteId };
    const optimistic: QuoteItem = {
      ...insertData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as QuoteItem;
    optimisticIdsRef.current.add(optimisticId);
    setItems((prev) => [...prev, optimistic].sort((a, b) => a.sort_order - b.sort_order));

    const { data, error } = await supabase
      .from("quote_items")
      .insert(insertData as unknown as TablesInsert<"quote_items">)
      .select()
      .single();

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
    return real;
  }, [quoteId]);

  const updateItem = useCallback(async (id: string, patch: QuoteItemUpdate) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } as QuoteItem : i));
    const { error } = await supabase
      .from("quote_items")
      .update(patch as TablesUpdate<"quote_items">)
      .eq("id", id);
    if (!mountedRef.current) return;
    if (error) {
      toast({ title: "Error updating item", description: error.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  const deleteItem = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_item_id !== id));
    const { error } = await supabase.from("quote_items").delete().eq("id", id);
    if (!mountedRef.current) return;
    if (error) {
      toast({ title: "Error deleting item", description: error.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  const moveItemToArea = useCallback(async (itemId: string, areaId: string | null) => {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, area_id: areaId } : i));
    const { error } = await supabase
      .from("quote_items")
      .update({ area_id: areaId } as TablesUpdate<"quote_items">)
      .eq("id", itemId);
    if (!mountedRef.current) return;
    if (error) {
      toast({ title: "Error moving item", description: error.message, variant: "destructive" });
      revert(fetchAll);
    }
  }, [fetchAll]);

  /* ── Helpers ── */
  const ensureDefaultArea = useCallback(async (): Promise<QuoteArea | null> => {
    // Coalesce concurrent callers so we never create two "General" areas
    if (ensuringRef.current) return ensuringRef.current;

    const run = (async (): Promise<QuoteArea | null> => {
      const currentItems = itemsRef.current;
      const currentAreas = areasRef.current;
      if (!needsDefaultArea(currentItems, currentAreas)) {
        if (currentAreas.length > 0) {
          const orphans = currentItems.filter((i) => !i.area_id && !i.parent_item_id);
          if (orphans.length > 0) {
            const defaultArea = currentAreas[0];
            const results = await Promise.all(orphans.map((i) =>
              supabase
                .from("quote_items")
                .update({ area_id: defaultArea.id } as TablesUpdate<"quote_items">)
                .eq("id", i.id)
            ));
            if (!mountedRef.current) return defaultArea;
            const firstErr = results.find((r) => r.error)?.error;
            if (firstErr) {
              toast({ title: "Error assigning items to area", description: firstErr.message, variant: "destructive" });
              revert(fetchAll);
            } else {
              setItems((prev) => prev.map((i) =>
                !i.area_id && !i.parent_item_id ? { ...i, area_id: defaultArea.id } : i
              ));
            }
          }
          return currentAreas[0];
        }
        return currentAreas[0] || null;
      }
      const area = await addArea(getDefaultAreaName());
      if (area && mountedRef.current) {
        const orphans = itemsRef.current.filter((i) => !i.area_id && !i.parent_item_id);
        if (orphans.length > 0) {
          const results = await Promise.all(orphans.map((i) =>
            supabase
              .from("quote_items")
              .update({ area_id: area.id } as TablesUpdate<"quote_items">)
              .eq("id", i.id)
          ));
          if (!mountedRef.current) return area;
          const firstErr = results.find((r) => r.error)?.error;
          if (firstErr) {
            toast({ title: "Error assigning items to area", description: firstErr.message, variant: "destructive" });
            revert(fetchAll);
          } else {
            setItems((prev) => prev.map((i) =>
              !i.area_id && !i.parent_item_id ? { ...i, area_id: area.id } : i
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

  const value: QuoteContextValue = useMemo(() => ({
    quoteId,
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
  }), [quoteId, meta, areas, items, loading, error, canSave, updateQuote, addArea, updateArea, deleteArea, reorderAreas, addItem, updateItem, deleteItem, moveItemToArea, ensureDefaultArea, getItemsByArea, getBundleChildrenFn]);

  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

export default QuoteContext;

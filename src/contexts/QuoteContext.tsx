/**
 * QuoteContext — single source of truth for all three quote builders.
 * Wraps Supabase CRUD + realtime subscriptions for quotes, quote_areas, quote_items.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
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

/* ────────────────── Provider ────────────────── */

export function QuoteProvider({ quoteId, children }: { quoteId: string; children: React.ReactNode }) {
  const [meta, setMeta] = useState<QuoteMeta | null>(null);
  const [areas, setAreas] = useState<QuoteArea[]>([]);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const itemsRef = useRef<QuoteItem[]>([]);
  const areasRef = useRef<QuoteArea[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { areasRef.current = areas; }, [areas]);

  /* ── Fetch ── */
  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [quoteRes, areasRes, itemsRes] = await Promise.all([
        supabase.from("quotes").select("id, quote_number, customer_id, customer_name, status, subtotal, vat_rate, vat_amount, total, notes, valid_until, discount_type, discount_value, terms_text, reference_text").eq("id", quoteId).single(),
        supabase.from("quote_areas").select("*").eq("quote_id", quoteId).order("sort_order"),
        supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order"),
      ]);

      if (!mountedRef.current) return;

      if (quoteRes.error) throw quoteRes.error;
      if (areasRes.error) throw areasRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setMeta(quoteRes.data as unknown as QuoteMeta);
      setAreas((areasRes.data || []) as unknown as QuoteArea[]);
      setItems((itemsRes.data || []) as unknown as QuoteItem[]);
      setError(null);
    } catch (e: any) {
      console.error("QuoteContext fetch error:", e);
      setError(e.message || "Failed to load quote");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
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
          setAreas((prev) => {
            if (prev.find((a) => a.id === (payload.new as any).id)) return prev;
            return [...prev, payload.new as unknown as QuoteArea].sort((a, b) => a.sort_order - b.sort_order);
          });
        } else if (payload.eventType === "UPDATE" && payload.new) {
          setAreas((prev) => prev.map((a) => a.id === (payload.new as any).id ? payload.new as unknown as QuoteArea : a));
        } else if (payload.eventType === "DELETE" && payload.old) {
          setAreas((prev) => prev.filter((a) => a.id !== (payload.old as any).id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_items", filter: `quote_id=eq.${quoteId}` }, (payload) => {
        if (payload.eventType === "INSERT" && payload.new) {
          setItems((prev) => {
            if (prev.find((i) => i.id === (payload.new as any).id)) return prev;
            return [...prev, payload.new as unknown as QuoteItem].sort((a, b) => a.sort_order - b.sort_order);
          });
        } else if (payload.eventType === "UPDATE" && payload.new) {
          setItems((prev) => prev.map((i) => i.id === (payload.new as any).id ? payload.new as unknown as QuoteItem : i));
        } else if (payload.eventType === "DELETE" && payload.old) {
          setItems((prev) => prev.filter((i) => i.id !== (payload.old as any).id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [quoteId]);

  /* ── Derived ── */
  const canSave = !!meta?.customer_id;

  /* ── Quote meta ── */
  const updateQuote = useCallback(async (patch: Partial<Pick<QuoteMeta, "customer_id" | "customer_name" | "notes" | "status" | "discount_type" | "discount_value" | "terms_text" | "reference_text">>) => {
    let wasNullCustomer = false;
    // Optimistic — use functional update to read fresh state
    setMeta((prev) => {
      if (prev && !prev.customer_id) wasNullCustomer = true;
      return prev ? { ...prev, ...patch } : prev;
    });
    const { error } = await supabase.from("quotes").update(patch as any).eq("id", quoteId);
    if (error) {
      toast({ title: "Error updating quote", description: error.message, variant: "destructive" });
      fetchAll(); // revert
      return;
    }
    // If customer_id was just set from null, reload to get trigger-assigned quote_number
    if (wasNullCustomer && patch.customer_id) {
      const { data: refreshed } = await supabase.from("quotes").select("quote_number").eq("id", quoteId).single();
      if (refreshed?.quote_number) {
        setMeta((prev) => prev ? { ...prev, quote_number: refreshed.quote_number } : prev);
      }
    }
  }, [quoteId, fetchAll]);

  /* ── Areas ── */
  const addArea = useCallback(async (name: string): Promise<QuoteArea | null> => {
    const nextOrder = areas.length;
    const optimisticId = crypto.randomUUID();
    const optimistic: QuoteArea = {
      id: optimisticId,
      quote_id: quoteId,
      name,
      sort_order: nextOrder,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setAreas((prev) => [...prev, optimistic]);

    const { data, error } = await supabase
      .from("quote_areas")
      .insert({ quote_id: quoteId, name, sort_order: nextOrder })
      .select()
      .single();

    if (error) {
      toast({ title: "Error adding area", description: error.message, variant: "destructive" });
      setAreas((prev) => prev.filter((a) => a.id !== optimisticId));
      return null;
    }
    // Replace optimistic with real
    setAreas((prev) => prev.map((a) => a.id === optimisticId ? data as unknown as QuoteArea : a));
    return data as unknown as QuoteArea;
  }, [quoteId, areas.length]);

  const updateArea = useCallback(async (id: string, patch: QuoteAreaUpdate) => {
    setAreas((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } as QuoteArea : a));
    const { error } = await supabase.from("quote_areas").update(patch as any).eq("id", id);
    if (error) {
      toast({ title: "Error updating area", description: error.message, variant: "destructive" });
      fetchAll();
    }
  }, [fetchAll]);

  const deleteArea = useCallback(async (id: string) => {
    setAreas((prev) => prev.filter((a) => a.id !== id));
    // Items with this area_id will be set to null by ON DELETE SET NULL
    setItems((prev) => prev.map((i) => i.area_id === id ? { ...i, area_id: null } : i));
    const { error } = await supabase.from("quote_areas").delete().eq("id", id);
    if (error) {
      toast({ title: "Error deleting area", description: error.message, variant: "destructive" });
      fetchAll();
    }
  }, [fetchAll]);

  const reorderAreas = useCallback(async (orderedIds: string[]) => {
    setAreas((prev) => {
      const map = new Map(prev.map((a) => [a.id, a]));
      return orderedIds.map((id, i) => ({ ...map.get(id)!, sort_order: i }));
    });
    // Batch update sort_order
    await Promise.all(
      orderedIds.map((id, i) => supabase.from("quote_areas").update({ sort_order: i }).eq("id", id))
    );
  }, []);

  /* ── Items ── */
  const addItem = useCallback(async (item: Omit<QuoteItemInsert, "quote_id">): Promise<QuoteItem | null> => {
    const insertData = { ...item, quote_id: quoteId };
    const optimisticId = item.id || crypto.randomUUID();
    const optimistic: QuoteItem = {
      ...insertData,
      id: optimisticId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as QuoteItem;
    setItems((prev) => [...prev, optimistic].sort((a, b) => a.sort_order - b.sort_order));

    const { data, error } = await supabase
      .from("quote_items")
      .insert(insertData as any)
      .select()
      .single();

    if (error) {
      toast({ title: "Error adding item", description: error.message, variant: "destructive" });
      setItems((prev) => prev.filter((i) => i.id !== optimisticId));
      return null;
    }
    setItems((prev) => prev.map((i) => i.id === optimisticId ? data as unknown as QuoteItem : i));
    return data as unknown as QuoteItem;
  }, [quoteId]);

  const updateItem = useCallback(async (id: string, patch: QuoteItemUpdate) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } as QuoteItem : i));
    const { error } = await supabase.from("quote_items").update(patch as any).eq("id", id);
    if (error) {
      toast({ title: "Error updating item", description: error.message, variant: "destructive" });
      fetchAll();
    }
  }, [fetchAll]);

  const deleteItem = useCallback(async (id: string) => {
    // Also remove children (cascade in DB, but remove locally too)
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_item_id !== id));
    const { error } = await supabase.from("quote_items").delete().eq("id", id);
    if (error) {
      toast({ title: "Error deleting item", description: error.message, variant: "destructive" });
      fetchAll();
    }
  }, [fetchAll]);

  const moveItemToArea = useCallback(async (itemId: string, areaId: string | null) => {
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, area_id: areaId } : i));
    const { error } = await supabase.from("quote_items").update({ area_id: areaId } as any).eq("id", itemId);
    if (error) {
      toast({ title: "Error moving item", description: error.message, variant: "destructive" });
      fetchAll();
    }
  }, [fetchAll]);

  /* ── Helpers ── */
  const ensureDefaultArea = useCallback(async (): Promise<QuoteArea | null> => {
    if (!needsDefaultArea(items, areas)) {
      // If areas exist but items have null area_id, assign them to first area
      if (areas.length > 0) {
        const orphans = items.filter((i) => !i.area_id && !i.parent_item_id);
        if (orphans.length > 0) {
          const defaultArea = areas[0];
          await Promise.all(orphans.map((i) =>
            supabase.from("quote_items").update({ area_id: defaultArea.id } as any).eq("id", i.id)
          ));
          setItems((prev) => prev.map((i) =>
            !i.area_id && !i.parent_item_id ? { ...i, area_id: defaultArea.id } : i
          ));
        }
        return areas[0];
      }
      return areas[0] || null;
    }
    // Create "General" area
    const area = await addArea(getDefaultAreaName());
    if (area) {
      // Assign all orphan items to this area
      const orphans = items.filter((i) => !i.area_id && !i.parent_item_id);
      await Promise.all(orphans.map((i) =>
        supabase.from("quote_items").update({ area_id: area.id } as any).eq("id", i.id)
      ));
      setItems((prev) => prev.map((i) =>
        !i.area_id && !i.parent_item_id ? { ...i, area_id: area.id } : i
      ));
    }
    return area;
  }, [items, areas, addArea]);

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

  const value: QuoteContextValue = {
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
  };

  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

export default QuoteContext;

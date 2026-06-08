import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCallback } from "react";

export type StockMode = "order_as_needed" | "stock_sensitive";

export interface StockRecord {
  id: string;
  product_id: string;
  quantity: number;
  low_stock_threshold: number;
  stock_mode: StockMode;
}

export interface StockAdjustment {
  id: string;
  stock_id: string;
  user_id: string | null;
  old_quantity: number;
  new_quantity: number;
  reason: string | null;
  changed_at: string;
}

export function useInventoryStock() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stockMap = new Map<string, StockRecord>(), isLoading } = useQuery({
    queryKey: ["inventory-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("id, product_id, quantity, low_stock_threshold, stock_mode");
      if (error) throw error;
      const map = new Map<string, StockRecord>();
      (data || []).forEach((row) => {
        const r = row as unknown as StockRecord;
        map.set(r.product_id, r);
      });
      return map;
    },
  });

  const lowStockCount = useQuery({
    queryKey: ["low-stock-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("quantity, low_stock_threshold, stock_mode");
      if (error) return 0;
      return (data || []).filter((row) => {
        const r = row as unknown as Pick<StockRecord, "quantity" | "low_stock_threshold" | "stock_mode">;
        return r.stock_mode === "stock_sensitive" && r.quantity <= r.low_stock_threshold;
      }).length;
    },
  });

  const updateStock = useMutation({
    mutationFn: async ({
      productId,
      newQuantity,
      reason,
    }: {
      productId: string;
      newQuantity: number;
      reason?: string;
    }) => {
      const existing = stockMap.get(productId);
      const oldQty = existing?.quantity ?? 0;

      if (existing) {
        const { error } = await supabase
          .from("inventory_stock")
          .update({ quantity: newQuantity })
          .eq("id", existing.id);
        if (error) throw error;

        const { error: adjErr } = await supabase
          .from("inventory_adjustments")
          .insert({
            stock_id: existing.id,
            old_quantity: oldQty,
            new_quantity: newQuantity,
            reason: reason || null,
          });
        if (adjErr) throw adjErr;
      } else {
        const { data: newStock, error } = await supabase
          .from("inventory_stock")
          .insert({ product_id: productId, quantity: newQuantity, stock_mode: "stock_sensitive" })
          .select("id")
          .single();
        if (error) throw error;

        await supabase.from("inventory_adjustments").insert({
          stock_id: newStock.id,
          old_quantity: 0,
          new_quantity: newQuantity,
          reason: reason || null,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count-sidebar"] });
    },
    onError: (err: Error) => {
      toast({ title: "Stock update failed", description: err.message, variant: "destructive" });
    },
  });

  const updateStockMode = useMutation({
    mutationFn: async ({
      productId,
      mode,
    }: {
      productId: string;
      mode: StockMode;
    }) => {
      const existing = stockMap.get(productId);

      if (existing) {
        const updatePayload: { stock_mode: StockMode; quantity?: number } = { stock_mode: mode };
        if (mode === "stock_sensitive" && existing.quantity === null) {
          updatePayload.quantity = 0;
        }
        const { error } = await supabase
          .from("inventory_stock")
          .update(updatePayload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("inventory_stock")
          .insert({
            product_id: productId,
            quantity: 0,
            stock_mode: mode,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count-sidebar"] });
    },
    onError: (err: Error) => {
      toast({ title: "Mode update failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkUpdateMode = useMutation({
    mutationFn: async ({
      productIds,
      mode,
    }: {
      productIds: string[];
      mode: StockMode;
    }) => {
      for (const productId of productIds) {
        const existing = stockMap.get(productId);
        if (existing) {
          const updatePayload: { stock_mode: StockMode; quantity?: number } = { stock_mode: mode };
          if (mode === "stock_sensitive" && (existing.quantity === null || existing.quantity === undefined)) {
            updatePayload.quantity = 0;
          }
          await supabase
            .from("inventory_stock")
            .update(updatePayload)
            .eq("id", existing.id);
        } else {
          await supabase
            .from("inventory_stock")
            .insert({
              product_id: productId,
              quantity: 0,
              stock_mode: mode,
            });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count-sidebar"] });
      toast({ title: "Stock modes updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk mode update failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkUpdate = useMutation({
    mutationFn: async (
      updates: { productId: string; quantity: number; reason?: string }[]
    ) => {
      for (const u of updates) {
        const existing = stockMap.get(u.productId);
        const oldQty = existing?.quantity ?? 0;

        if (existing) {
          const { error } = await supabase
            .from("inventory_stock")
            .update({ quantity: u.quantity })
            .eq("id", existing.id);
          if (error) throw error;

          await supabase.from("inventory_adjustments").insert({
            stock_id: existing.id,
            old_quantity: oldQty,
            new_quantity: u.quantity,
            reason: u.reason || "Bulk update",
          });
        } else {
          const { data: newStock, error } = await supabase
            .from("inventory_stock")
            .insert({ product_id: u.productId, quantity: u.quantity })
            .select("id")
            .single();
          if (error) throw error;

          await supabase.from("inventory_adjustments").insert({
            stock_id: newStock.id,
            old_quantity: 0,
            new_quantity: u.quantity,
            reason: u.reason || "Bulk update",
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count-sidebar"] });
      toast({ title: "Bulk stock update complete" });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk update failed", description: err.message, variant: "destructive" });
    },
  });

  return {
    stockMap,
    isLoadingStock: isLoading,
    lowStockCount: lowStockCount.data ?? 0,
    updateStock,
    updateStockMode,
    bulkUpdateMode,
    bulkUpdate,
  };
}

export function useStockAdjustments(stockId: string | null) {
  return useQuery({
    queryKey: ["stock-adjustments", stockId],
    enabled: !!stockId,
    queryFn: async () => {
      if (!stockId) return [];
      const { data, error } = await supabase
        .from("inventory_adjustments")
        .select("*")
        .eq("stock_id", stockId)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as StockAdjustment[];
    },
  });
}

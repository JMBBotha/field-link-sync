import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCallback } from "react";

export interface StockRecord {
  id: string;
  product_id: string;
  quantity: number;
  low_stock_threshold: number;
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
        .select("id, product_id, quantity, low_stock_threshold");
      if (error) throw error;
      const map = new Map<string, StockRecord>();
      (data || []).forEach((row: any) => map.set(row.product_id, row as StockRecord));
      return map;
    },
  });

  const lowStockCount = useQuery({
    queryKey: ["low-stock-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("id", { count: "exact" })
        .filter("quantity", "lte", "low_stock_threshold" as any);
      // Workaround: fetch all and count client-side
      if (error) {
        const { data: all, error: e2 } = await supabase
          .from("inventory_stock")
          .select("quantity, low_stock_threshold");
        if (e2) return 0;
        return (all || []).filter((r: any) => r.quantity <= r.low_stock_threshold).length;
      }
      return data?.length ?? 0;
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
          .insert({ product_id: productId, quantity: newQuantity })
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
    },
    onError: (err: Error) => {
      toast({ title: "Stock update failed", description: err.message, variant: "destructive" });
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

import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

export function useQuoteBuilderFavorites(products: PaletteProduct[]) {
  const queryClient = useQueryClient();

  const favorites = useMemo(() => new Set(products.filter(p => p.is_pinned).map(p => p.id)), [products]);

  const togglePinMutation = useMutation({
    mutationFn: async (productId: string) => {
      const currentlyPinned = products.find(p => p.id === productId)?.is_pinned ?? false;
      const pinOrder = currentlyPinned ? 0 : Math.floor(Date.now() / 1000) % 2000000000;
      const { error } = await (supabase.from("supplier_products") as any)
        .update({ is_pinned: !currentlyPinned, pin_order: pinOrder } as any).eq("id", productId);
      if (error) throw error;
    },
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: ["quote-builder-products"] });
      queryClient.setQueryData<PaletteProduct[]>(["quote-builder-products"], (old) =>
        old?.map((p) => p.id === productId ? { ...p, is_pinned: !p.is_pinned } : p)
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
    },
  });

  const toggleFavorite = useCallback((id: string) => togglePinMutation.mutate(id), [togglePinMutation]);

  return { favorites, toggleFavorite };
}

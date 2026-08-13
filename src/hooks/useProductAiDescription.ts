import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface GenerateDescriptionResponse {
  description: string;
  generatedAt: string;
  cached: boolean;
  error?: string;
}

/**
 * Fetches (and lazily generates + caches) an AI sales description for a supplier_products row.
 * The edge function itself checks the DB cache first — if `ai_sales_description` already exists
 * it's returned instantly with no AI call. Call `regenerate()` to force a fresh AI-written version.
 */
export function useProductAiDescription(
  productId: string | undefined,
  cachedDescription?: string | null,
  cachedGeneratedAt?: string | null
) {
  const queryClient = useQueryClient();
  const queryKey = ["product-ai-description", productId];

  const query = useQuery({
    queryKey,
    enabled: false, // only fetch on demand via generate()/regenerate() — don't auto-call AI on every render
    queryFn: async (): Promise<GenerateDescriptionResponse> => {
      const { data, error } = await supabase.functions.invoke("generate-product-description", {
        body: { productId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as GenerateDescriptionResponse;
    },
    initialData: cachedDescription
      ? { description: cachedDescription, generatedAt: cachedGeneratedAt ?? "", cached: true }
      : undefined,
  });

  const regenerateMutation = useMutation({
    mutationFn: async (): Promise<GenerateDescriptionResponse> => {
      if (!productId) throw new Error("Missing productId");
      const { data, error } = await supabase.functions.invoke("generate-product-description", {
        body: { productId, regenerate: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as GenerateDescriptionResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  const generate = () => {
    if (!productId) return;
    query.refetch();
  };

  return {
    description: query.data?.description ?? cachedDescription ?? null,
    generatedAt: query.data?.generatedAt ?? cachedGeneratedAt ?? null,
    isLoading: query.isFetching || regenerateMutation.isPending,
    error: (query.error as Error | null) ?? (regenerateMutation.error as Error | null),
    generate,
    regenerate: () => regenerateMutation.mutate(),
  };
}

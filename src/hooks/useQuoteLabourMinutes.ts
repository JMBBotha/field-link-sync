import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { quoteLabourMinutes } from "@/lib/schedulingDefaults";

/** Sum of labour-line hours on a quote → booking minutes (rounded to 30, 30 min–12 h). Mirrors SQL _tech_offer_minutes. */
export function useQuoteLabourMinutes(quoteId?: string | null) {
  return useQuery({
    queryKey: ["quote-labour-minutes", quoteId],
    enabled: !!quoteId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("quote_items").select("quantity, item_type").eq("quote_id", quoteId!);
      if (error) return null;
      const hours = (data ?? [])
        .filter((r: any) => String(r.item_type || "").toLowerCase() === "labour")
        .reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0);
      return quoteLabourMinutes(hours);
    },
  });
}

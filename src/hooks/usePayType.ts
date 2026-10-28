import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Signed-in user's pay type. Salaried staff see no earnings or commission (Johan 28 Oct). */
export function useIsSalaried(): boolean {
  const { data } = useQuery({
    queryKey: ["my-pay-type"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_pay_type");
      if (error) return "commission";
      return (data as string) ?? "commission";
    },
  });
  return data === "salary";
}

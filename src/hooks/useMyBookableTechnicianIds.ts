import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";

/** Assignment rows for the signed-in salesperson. Office callers get isSalesRep false and ids null. */
export function useMyBookableTechnicianIds() {
  const { isSalesRep, loading: salesLoading } = useSalesRep();
  const { userId } = useRole();
  const query = useQuery({
    queryKey: ["sales-rep-technicians", "mine", userId],
    enabled: isSalesRep && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_rep_technicians")
        .select("technician_id")
        .eq("sales_rep_id", userId!);
      if (error) throw error;
      return (data || []).map((row) => row.technician_id);
    },
  });
  return {
    isSalesRep,
    loading: salesLoading || (isSalesRep && query.isLoading),
    failed: isSalesRep && query.isError,
    ids: isSalesRep ? (query.data ?? []) : null,
  };
}

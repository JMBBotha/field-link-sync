import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";

/** Independent agents waiting for approval (network_status = pending). Admin only; polls every 30 s. */
export function usePendingApplicants() {
  const { isAdmin } = useRole();
  const q = useQuery({
    queryKey: ["pending-applicants"],
    enabled: isAdmin,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, skills, participant_type, created_at")
        .in("participant_type", ["independent_sales", "independent_tech"] as any)
        .eq("network_status", "pending")
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  return { pending: q.data ?? [], count: q.data?.length ?? 0 };
}

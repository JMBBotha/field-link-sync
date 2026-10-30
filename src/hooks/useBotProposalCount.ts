import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Pending WALDA proposals for the signed-in admin's company (0 for everyone else). */
export function useBotProposalCount(enabled = true) {
  const { data = 0 } = useQuery({
    queryKey: ["bot-proposal-count"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_pending_proposal_count");
      if (error) return 0;
      return (data as number) ?? 0;
    },
  });
  return data;
}

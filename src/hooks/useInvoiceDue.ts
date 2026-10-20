import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHeartbeatAudience } from "@/hooks/useSalesHeartbeat";
import { summarizeDue, type DueRow } from "@/lib/invoiceDue";

/** Open final invoices (company-scoped; sales reps see only their own) for the Invoices badge, Money due tile and due chips. */
export function useInvoiceDue() {
  const { canSee } = useHeartbeatAudience();
  const q = useQuery({
    queryKey: ["invoice-due"], enabled: canSee, refetchInterval: 120_000, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("invoice_due_summary");
      if (error) throw error;
      return (data || []) as DueRow[];
    },
  });
  const rows = q.data || [];
  const summary = useMemo(() => summarizeDue(rows), [rows]);
  const byInvoice = useMemo(() => new Map(rows.map((r) => [r.invoice_id, r])), [rows]);
  return { rows, summary, byInvoice, canSee, loading: q.isLoading, refetch: q.refetch };
}

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
      const rows = (data || []) as DueRow[];
      // Pencil-set expected final payment dates (due_date_source = manual) on waiting rows: read-only, shown as "Expected <date>".
      const ids = rows.filter((r) => r.waiting).map((r) => r.invoice_id);
      if (ids.length) {
        const { data: inv } = await (supabase as any).from("invoices").select("id, due_date, due_date_source").in("id", ids);
        const m = new Map(((inv || []) as any[]).filter((i) => i.due_date && i.due_date_source === "manual").map((i) => [i.id, i.due_date as string]));
        rows.forEach((r) => { if (m.has(r.invoice_id)) r.expected_at = m.get(r.invoice_id); });
      }
      return rows;
    },
  });
  const rows = q.data || [];
  const summary = useMemo(() => summarizeDue(rows), [rows]);
  const byInvoice = useMemo(() => new Map(rows.map((r) => [r.invoice_id, r])), [rows]);
  return { rows, summary, byInvoice, canSee, loading: q.isLoading, refetch: q.refetch };
}

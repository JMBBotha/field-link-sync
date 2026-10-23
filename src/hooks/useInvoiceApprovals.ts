import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { holdInvoiceSend, resultMessage, sendInvoiceNow, sortApprovals, type InvoiceSendApproval } from "@/lib/invoiceSendApproval";

export const APPROVALS_KEY = ["invoice-send-approvals"];

/** Open invoice-send approvals the signed-in user may act on (RLS: the quote's rep + that company's admins only). */
export function useInvoiceApprovals(enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: APPROVALS_KEY,
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data, error } = await (supabase.from("invoice_send_approvals" as any) as any)
        .select("id, invoice_id, quote_id, client_name, quote_number, invoice_number, deposit_amount, status, due_at, decision, decided_by, decided_at, hold_reason, last_error, created_at")
        .in("status", ["pending", "held", "blocked"]).gte("created_at", since).limit(50);
      if (error) return [] as InvoiceSendApproval[];
      return sortApprovals((data || []) as InvoiceSendApproval[]);
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel("invoice-send-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_send_approvals" }, () => qc.invalidateQueries({ queryKey: APPROVALS_KEY }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, qc]);

  const run = async (p: Promise<string>) => {
    try {
      const m = resultMessage(await p);
      (m.ok ? toast.success : toast.error)(m.text);
      return m.ok;
    } catch (e: any) {
      toast.error(e?.message || "Could not update the invoice");
      return false;
    } finally {
      qc.invalidateQueries({ queryKey: APPROVALS_KEY });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    }
  };

  return {
    items: q.data || [],
    isLoading: q.isLoading,
    sendNow: (invoiceId: string) => run(sendInvoiceNow(invoiceId)),
    hold: (invoiceId: string, reason?: string | null) => run(holdInvoiceSend(invoiceId, reason)),
  };
}

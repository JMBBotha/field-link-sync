import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HOUSE_EMBED, invoiceHouseLabel } from "@/lib/invoiceHouse";

/** "House 12" for a project (estate) invoice, or null. Display only (Johan 4 Nov 20:16). */
export function useInvoiceHouseLabel(invoiceId?: string | null): string | null {
  const { data } = useQuery({
    queryKey: ["invoice-house", invoiceId], enabled: !!invoiceId, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("invoices").select(`id, notes, line_items, ${HOUSE_EMBED}`).eq("id", invoiceId).maybeSingle();
      return invoiceHouseLabel(data) ?? null;
    },
  });
  return data ?? null;
}

/** House labels for many invoices at once, keyed by invoice id. */
export function useInvoiceHouseLabels(invoiceIds: (string | null | undefined)[]): Map<string, string> {
  const ids = [...new Set(invoiceIds.filter(Boolean) as string[])].sort();
  const { data } = useQuery({
    queryKey: ["invoice-houses", ids.join(",")], enabled: ids.length > 0, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("invoices").select(`id, notes, line_items, ${HOUSE_EMBED}`).in("id", ids);
      const m = new Map<string, string>();
      for (const r of (data ?? []) as any[]) { const l = invoiceHouseLabel(r); if (l) m.set(r.id, l); }
      return m;
    },
  });
  return data ?? new Map();
}

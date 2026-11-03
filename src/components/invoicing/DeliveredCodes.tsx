import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deliveredSuggestions, type DeliveredSuggestion, type DeliveredUnit, type InvoiceLineLite } from "@/lib/deliveredCodes";

type Q = { eq: (c: string, v: unknown) => Q; in: (c: string, v: unknown[]) => Q; order: (c: string) => Q; then: Promise<{ data: unknown[] | null; error: unknown }>["then"] };
const sb = supabase as unknown as { from: (t: string) => { select: (c: string) => Q } };

/** Delivered units on the job(s) linked to this invoice (job_delivered_units). Empty until the table exists. */
export function useDeliveredSuggestions(invoiceId: string | null | undefined, lines: InvoiceLineLite[]) {
  const q = useQuery({
    queryKey: ["delivered-units", invoiceId],
    enabled: !!invoiceId,
    staleTime: 60_000,
    queryFn: async (): Promise<DeliveredUnit[]> => {
      const { data: jobs } = await sb.from("jobs").select("id").eq("invoice_id", invoiceId);
      const ids = ((jobs ?? []) as { id: string }[]).map((j) => j.id);
      if (!ids.length) return [];
      const { data, error } = await sb.from("job_delivered_units").select("job_id, product_id, half, supplier_code, serial_no, qty").in("job_id", ids).order("delivered_at");
      if (error) return []; // table not deployed yet
      return (data ?? []) as DeliveredUnit[];
    },
  });
  return deliveredSuggestions(lines, q.data ?? []);
}

/** Shown under a matching unit line. Editable invoice: offer to write it in. Locked invoice: suggestion only. */
export function DeliveredHint({ s, onWrite }: { s: DeliveredSuggestion | undefined; onWrite?: () => void }) {
  if (!s) return null;
  return (
    <div data-testid="delivered-hint" className="mt-1 flex flex-wrap items-center gap-2 rounded bg-sky-50 dark:bg-sky-500/10 px-2 py-1 text-xs text-sky-900 dark:text-sky-200">
      <span>{s.text}</span>
      {s.alreadyOnLine ? <span className="text-muted-foreground">(already on the line)</span>
        : onWrite ? <button type="button" className="underline font-medium" onClick={onWrite}>Write onto line</button>
        : <span className="text-muted-foreground">(invoice locked – suggestion only)</span>}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Row = { id: string; lead_id: string; customer_name: string | null; requested_by_name: string | null; created_at: string };

/** Office-only (the RPC returns nothing for anyone else): sales' pending reassignment requests on the Jobs page. In-app only. */
export default function ReassignRequestsBanner({ onOpen }: { onOpen: (leadId: string) => void }) {
  const { data = [] } = useQuery({
    queryKey: ["pending-reassign"], refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("pending_reassign_requests");
      if (error) return [] as Row[];
      return (data || []) as Row[];
    },
  });
  if (!data.length) return null;
  return (
    <div className="mx-3 mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:mx-4" data-testid="reassign-banner">
      <p className="font-semibold">{data.length === 1 ? "1 reassignment request" : `${data.length} reassignment requests`}</p>
      <ul className="mt-1 space-y-1">
        {data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{(r.customer_name || "Lead").trim()} · from {(r.requested_by_name || "sales").trim()}</span>
            <button onClick={() => onOpen(r.lead_id)} className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1590D6] shadow-sm dark:bg-background">Review</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

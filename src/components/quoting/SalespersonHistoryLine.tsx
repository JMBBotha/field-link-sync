/** Read-only salesperson history for a quote, from status_change_log 'Change salesperson' entries (Job 5). */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { salespersonHistory, salespersonHistoryText, type SalespersonLogRow } from "@/lib/salesTracker";

export default function SalespersonHistoryLine({ quoteId }: { quoteId: string | null | undefined }) {
  const { data: text } = useQuery({
    queryKey: ["salesperson-history", quoteId],
    enabled: !!quoteId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("status_change_log") as any)
        .select("old_status, new_status, changed_by, created_at")
        .eq("entity_type", "quote").eq("entity_id", quoteId).eq("field_name", "sales_engineer_id")
        .order("created_at", { ascending: true });
      const changes = salespersonHistory((data ?? []) as SalespersonLogRow[]);
      if (!changes.length) return "";
      const ids = [...new Set(changes.flatMap((c) => [c.from, c.to, c.by]).filter(Boolean))] as string[];
      const { data: people } = await (supabase.from("profiles") as any).select("id, full_name").in("id", ids);
      const names: Record<string, string> = {};
      for (const p of (people ?? []) as { id: string; full_name: string | null }[]) names[p.id] = p.full_name || "Unknown";
      return salespersonHistoryText(changes, names);
    },
  });
  if (!text) return null;
  return (
    <p className="px-1 text-[11px] text-muted-foreground print:hidden" data-html2canvas-ignore data-testid="salesperson-history">
      Salesperson history: {text}
    </p>
  );
}

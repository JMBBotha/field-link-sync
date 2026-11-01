import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** "Option of Q-…" chip on the quote page when the quote is grouped with others (Johan 1 Nov 2026). */
export default function QuoteOptionChip({ quoteId, groupId }: { quoteId: string; groupId: string | null | undefined }) {
  const q = useQuery({
    queryKey: ["quote-option-siblings", groupId], enabled: !!groupId,
    queryFn: async () => {
      const { data } = await (supabase.from("quotes") as any).select("id, quote_number").eq("option_group_id", groupId).neq("id", quoteId).order("created_at");
      return (data || []) as { id: string; quote_number: string | null }[];
    },
  });
  if (!groupId || !q.data?.length) return null;
  return (
    <span data-pdf-hide data-testid="quote-option-chip" className="inline-flex flex-wrap items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:text-sky-200 print:hidden">
      Option of {q.data.map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link className="underline" to={`/admin/estimates/${s.id}`}>{s.quote_number || "quote"}</Link></span>)}
    </span>
  );
}

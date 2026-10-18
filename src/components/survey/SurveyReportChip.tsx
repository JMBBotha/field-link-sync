import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Quote page: chip linking to the site survey report behind this quote (staff only; the client never sees it). */
export default function SurveyReportChip({ quoteId, leadId }: { quoteId: string; leadId?: string | null }) {
  const q = useQuery({
    queryKey: ["quote-survey-chip", quoteId, leadId],
    queryFn: async () => {
      const sb = supabase as any;
      const { data: byQuote } = await sb.from("site_surveys").select("lead_id, report_no, status").eq("quote_id", quoteId).is("archived_at", null).maybeSingle();
      if (byQuote) return byQuote;
      if (!leadId) return null;
      const { data } = await sb.from("site_surveys").select("lead_id, report_no, status").eq("lead_id", leadId).is("archived_at", null).maybeSingle();
      return data ?? null;
    },
  });
  const s = q.data;
  if (!s) return null;
  return (
    <Link to={`/admin/visits/${s.lead_id}/survey/report`} className="v8-chip inline-flex items-center gap-1.5" data-testid="quote-survey-chip">
      <ClipboardCheck className="h-3.5 w-3.5" />Site survey {s.report_no || "(draft)"}
    </Link>
  );
}

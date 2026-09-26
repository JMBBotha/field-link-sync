import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import CallReportCard, { type CallReport } from "./CallReportCard";

export default function LeadCallReports({ leadId }: { leadId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["call-reports", "lead", leadId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("call_reports")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as CallReport[];
    },
  });
  if (!data.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Call reports</p>
      {data.map((r) => <CallReportCard key={r.id} report={r} showCaller />)}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { callChip, statusesByLead, type LeadCallStatus } from "@/lib/leadCallStatus";

/** Admin/office only (RPC returns nothing for techs and reps). One shared query for every card; display only. */
export function useLeadCallStatuses() {
  return useQuery({
    queryKey: ["lead-call-statuses"],
    staleTime: 15_000,
    refetchInterval: (q: any) => ([...(q?.state?.data?.values?.() ?? [])] as LeadCallStatus[]).some((s) => s.state === "calling" || s.state === "queued") ? 10_000 : 60_000,
    queryFn: async () => {
      const rpc = (supabase as any).rpc;
      if (typeof rpc !== "function") return new Map<string, LeadCallStatus>();
      const { data, error } = await rpc.call(supabase, "lead_call_statuses");
      if (error) return new Map<string, LeadCallStatus>();
      return statusesByLead(data as LeadCallStatus[]);
    },
  });
}

const TONE = { green: "bg-emerald-50 text-emerald-700 border-emerald-200", blue: "bg-sky-50 text-sky-700 border-sky-200", amber: "bg-amber-50 text-amber-700 border-amber-200", grey: "bg-slate-50 text-ink-secondary border-slate-200" };

export default function LeadCallChip({ leadId }: { leadId: string }) {
  const { data } = useLeadCallStatuses();
  const chip = callChip(data?.get(leadId));
  if (!chip) return null;
  return (
    <span data-testid="lead-call-chip" className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[chip.tone])}>
      <PhoneCall className="h-3 w-3" />{chip.text}
    </span>
  );
}

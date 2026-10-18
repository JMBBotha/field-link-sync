import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { draftForLead } from "@/lib/siteSurvey/store";

/** Visit detail: start / continue the guided site survey. */
export default function SurveyEntryCard({ leadId }: { leadId: string }) {
  const q = useQuery({
    queryKey: ["site-survey-entry", leadId],
    queryFn: async () => {
      const local = await draftForLead(leadId).catch(() => null);
      const { data } = await (supabase as any).from("site_surveys")
        .select("id, status, report_no, site_survey_rooms(count)").eq("lead_id", leadId).is("archived_at", null).maybeSingle();
      const rooms = local?.rooms.length ?? data?.site_survey_rooms?.[0]?.count ?? 0;
      const status = local && local.rev > local.syncedRev ? local.status : data?.status ?? local?.status ?? null;
      return { status: (local?.rev || data) ? status : null, report_no: data?.report_no ?? local?.report_no ?? null, rooms,
        unsynced: !!local && local.rev > local.syncedRev };
    },
  });
  const v = q.data;
  const label = !v?.status ? "Start site survey" : v.status === "complete" ? `Survey ${v.report_no ?? "finished"}` : "Continue site survey";
  const sub = !v?.status ? "Front photo, unit positions, pipe runs, notes" :
    `${v.rooms} room${v.rooms === 1 ? "" : "s"}${v.status === "complete" ? " · finished" : " · in progress"}${v.unsynced ? " · saved on phone" : ""}`;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2" data-testid="visit-survey">
      <h2 className="text-sm font-semibold">Site survey</h2>
      <Button asChild variant={v?.status === "complete" ? "outline" : "default"} className="w-full min-h-[48px] justify-between">
        <Link to={v?.status === "complete" ? `/admin/visits/${leadId}/survey/report` : `/admin/visits/${leadId}/survey`} data-testid="visit-survey-open">
          <span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />{label}</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </Button>
      <p className="text-xs text-muted-foreground">{sub}{v?.status === "complete" && <> · <Link className="underline" to={`/admin/visits/${leadId}/survey`}>Edit</Link></>}</p>
    </div>
  );
}

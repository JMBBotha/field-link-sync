import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useBookingTechnicians } from "@/hooks/useBookingTechnicians";
import { bookingTechListState } from "@/lib/bookingTechnicians";
import { Button } from "@/components/ui/button";
import { WorkIntent, VisitKindMenu, PastVisitFields, VisitList, HouseFirstFitLine, type PastDraft, type VisitView } from "@/components/jobs/BookJobForm";
import { kindsFromStored, includesFirstFix, customLabelMissing, workCards, installationJobForHouse, type Doing, type VisitKind, type HouseJobRef } from "@/lib/bookJobPath";
import { logPastVisit, correctPastVisit } from "@/lib/bookJobSave";
import { FIRST_FIT_STEP } from "@/lib/projectTracker";
import { johannesburgToday } from "@/lib/bookJobPath";

type JobBits = { id: string; title: string | null; leadId: string | null; companyId: string; customerId: string | null; jobType?: string | null };
type HouseBits = { id: string; house_no: string; steps?: { step_key: string; done: boolean }[] };

const emptyPast = (): PastDraft => ({ techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: false });

/** Same three choices and the same past-visit editor, on the job page and the project house. */
export default function LoggedWorkPanel({ surface, canLogPast, job, house, projectName, customerId, companyId, onSaved }: {
  surface: "job" | "house";
  canLogPast: boolean;
  job?: JobBits | null;
  house?: HouseBits | null;
  projectName?: string;
  customerId?: string | null;
  companyId?: string | null;
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [doing, setDoing] = useState<Doing>("upcoming");
  const [visitKinds, setVisitKinds] = useState<VisitKind[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [past, setPast] = useState<PastDraft>(emptyPast);
  const [correctId, setCorrectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const houseJob = useQuery({
    queryKey: ["house-install-job", customerId, house?.id],
    enabled: surface === "house" && !!customerId && !!house,
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id, title, description, customer_id, job_type, quote_id, lead_id").eq("customer_id", customerId!).limit(500);
      if (error) throw error;
      return installationJobForHouse(house!, (data || []) as HouseJobRef[], customerId!);
    },
  });
  const attached = surface === "job" ? job : houseJob.data ? {
    id: houseJob.data.id, title: houseJob.data.title, leadId: houseJob.data.lead_id ?? null,
    companyId: companyId || "", customerId: houseJob.data.customer_id, jobType: houseJob.data.job_type,
  } : null;
  const co = companyId || job?.companyId || "";

  const techs = useBookingTechnicians(co, !!co && canLogPast);
  const techState = bookingTechListState({
    companyId: co || null,
    companyLoading: false,
    companyError: !co,
    accessLoading: false,
    canLog: canLogPast,
    queryEnabled: !!co && canLogPast,
    isPending: techs.isPending,
    isFetching: techs.isFetching,
    isError: techs.isError,
    count: techs.data?.length ?? 0,
  });
  const visitsQ = useQuery({
    queryKey: ["backfill-list", attached?.id],
    enabled: !!attached?.id && canLogPast,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_backfill_list", { p_job: attached!.id });
      if (error) throw error;
      const rows = ((data as { visits?: any[] } | null)?.visits || []) as any[];
      return rows.map((v): VisitView => ({
        id: v.id,
        techId: v.tech_id || "",
        tech: v.tech || "Tech",
        date: String(v.work_date || "").slice(0, 10),
        arrive: String(v.start || "").slice(0, 5),
        leave: String(v.end || "").slice(0, 5),
        note: v.notes || "",
        kinds: kindsFromStored(v.visit_kinds, v.notes),
        customLabel: v.visit_custom || "",
      }));
    },
  });
  const visits = visitsQ.data || [];
  const fitDone = !!house?.steps?.some((s) => s.step_key === FIRST_FIT_STEP && s.done);
  const fitVisit = visits.some((v) => includesFirstFix(v.kinds));

  const pickKinds = (next: VisitKind[]) => {
    if (includesFirstFix(next) && !includesFirstFix(visitKinds)) setPast((p) => ({ ...p, completed: false }));
    setVisitKinds(next);
  };
  const pickVisit = (id: string) => {
    setCorrectId(id);
    const v = visits.find((x) => x.id === id);
    if (!v) return;
    if (v.kinds.length) setVisitKinds(v.kinds);
    setCustomLabel(v.customLabel || "");
    setPast({ techId: v.techId || past.techId, date: v.date || past.date, arrive: v.arrive || "08:00", leave: v.leave, note: v.note, completed: false });
  };

  const save = async () => {
    if (!canLogPast || !visitKinds.length || customLabelMissing(visitKinds, customLabel) || !co) return;
    setBusy(true);
    try {
      const other = visits.filter((v) => v.id !== correctId).flatMap((v) => v.kinds);
      if (doing === "correct") {
        if (!correctId || !attached?.id) throw new Error("Pick the visit to correct");
        await correctPastVisit({
          isAdmin: true, house: house ? { id: house.id } : null, customerId: customerId || attached.customerId, jobTitle: attached.title,
          visitId: correctId, jobId: attached.id, visitKinds, customLabel,
          techId: past.techId, date: past.date, arrive: past.arrive, leave: past.leave, note: past.note, completed: past.completed, otherKinds: other,
        });
        toast({ title: "Visit updated" });
      } else {
        await logPastVisit({
          isAdmin: true, companyId: co, userId: user?.id ?? null, customerId: customerId || attached?.customerId || "",
          projectName: projectName || "Job", house: house ? { id: house.id, house_no: house.house_no } : null,
          existingJob: attached ? { id: attached.id } : null, visitKinds, customLabel, techId: past.techId, date: past.date, arrive: past.arrive,
          leave: past.leave, note: past.note, completed: past.completed, title: attached?.title || "", address: "", otherKinds: other,
        });
        toast({ title: "Visit recorded" });
      }
      qc.invalidateQueries({ queryKey: ["backfill-list"] });
      qc.invalidateQueries({ queryKey: ["job-detail"] });
      qc.invalidateQueries({ queryKey: ["house-install-job"] });
      onSaved?.();
      setDoing("upcoming");
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const onJob = surface === "job";
  const cards = workCards(doing, onJob || !!attached);
  return (
    <div className="space-y-3" data-testid="logged-work" data-surface={surface}>
      <div>
        <h3 className="text-sm font-semibold">Book, log, or correct</h3>
        <p className="text-xs text-muted-foreground">Same choices as Book a job. Past visits stay on this {onJob ? "job" : "house"}.</p>
      </div>
      <WorkIntent value={doing} onChange={setDoing} />
      {house && <HouseFirstFitLine done={fitDone || fitVisit} inStep={fitDone && fitVisit} />}
      {attached && surface === "house" && <p className="text-sm" data-testid="attached-job">Attached to {attached.title || "the installation job"}. No new sale and no second job.</p>}
      {doing === "upcoming" && <p className="text-xs text-muted-foreground">Upcoming work uses this job's schedule. Logging a past visit or a correction is here, not only under Add on behalf of tech.</p>}
      {doing !== "upcoming" && cards === "visit" && <VisitKindMenu value={visitKinds} onChange={pickKinds} customLabel={customLabel} onCustomLabel={setCustomLabel} />}
      {doing !== "upcoming" && !canLogPast && <p data-testid="past-admin-only" className="text-sm text-amber-900">Only an admin can log or correct a past visit.</p>}
      {doing === "correct" && <VisitList visits={visits} correctId={correctId} onCorrect={pickVisit} />}
      {doing === "past" && visits.length > 0 && <VisitList visits={visits} />}
      {doing !== "upcoming" && canLogPast && (
        <PastVisitFields techs={techs.data || []} value={past} onChange={setPast} techsStatus={techState === "hidden" ? "ready" : techState} onRetryTechs={() => { void techs.refetch(); }} />
      )}
      {doing !== "upcoming" && (
        <Button className="h-11 w-full bg-[#C2410C] text-white hover:bg-[#9A3412]" disabled={busy || !canLogPast || !visitKinds.length || customLabelMissing(visitKinds, customLabel) || !past.techId || !past.date || !past.arrive} onClick={save} data-testid="logged-work-save">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{doing === "correct" ? "Save correction" : "Save visit"}
        </Button>
      )}
    </div>
  );
}

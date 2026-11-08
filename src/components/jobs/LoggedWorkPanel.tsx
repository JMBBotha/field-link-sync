import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mapDispatchCandidates } from "@/lib/teamGroups";
import { Button } from "@/components/ui/button";
import { WorkIntent, VisitKindCards, PastVisitFields, VisitList, HouseFirstFitLine, type PastDraft, type VisitView } from "@/components/jobs/BookJobForm";
import { kindFromStored, workCards, installationJobForHouse, defaultCompleted, type Doing, type VisitKind, type HouseJobRef } from "@/lib/bookJobPath";
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
  const [visitKind, setVisitKind] = useState<VisitKind | null>(null);
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

  const techs = useQuery({
    queryKey: ["dispatch-techs", co],
    enabled: !!co && canLogPast && doing !== "upcoming",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dispatchable_technicians" as any, { _company_id: co });
      if (error) throw error;
      return mapDispatchCandidates(data as any).map((t) => ({ id: t.id, name: t.full_name || "Technician" }));
    },
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
        kind: kindFromStored(v.visit_kind, v.notes),
      }));
    },
  });
  const visits = visitsQ.data || [];
  const fitDone = !!house?.steps?.some((s) => s.step_key === FIRST_FIT_STEP && s.done);
  const fitVisit = visits.some((v) => v.kind === "first_fix");

  const pickKind = (k: VisitKind) => {
    setVisitKind(k);
    if (k === "first_fix") setPast((p) => ({ ...p, completed: defaultCompleted(k) }));
  };
  const pickVisit = (id: string) => {
    setCorrectId(id);
    const v = visits.find((x) => x.id === id);
    if (!v) return;
    if (v.kind) setVisitKind(v.kind);
    setPast({ techId: v.techId || past.techId, date: v.date || past.date, arrive: v.arrive || "08:00", leave: v.leave, note: v.note, completed: false });
  };

  const save = async () => {
    if (!canLogPast || !visitKind || !co) return;
    setBusy(true);
    try {
      const other = visits.filter((v) => v.id !== correctId).map((v) => v.kind).filter((k): k is VisitKind => !!k);
      if (doing === "correct") {
        if (!correctId || !attached?.id) throw new Error("Pick the visit to correct");
        await correctPastVisit({
          isAdmin: true, house: house ? { id: house.id } : null, customerId: customerId || attached.customerId, jobTitle: attached.title,
          visitId: correctId, jobId: attached.id, visitKind,
          techId: past.techId, date: past.date, arrive: past.arrive, leave: past.leave, note: past.note, completed: past.completed, otherKinds: other,
        });
        toast({ title: "Visit updated" });
      } else {
        await logPastVisit({
          isAdmin: true, companyId: co, userId: user?.id ?? null, customerId: customerId || attached?.customerId || "",
          projectName: projectName || "Job", house: house ? { id: house.id, house_no: house.house_no } : null,
          existingJob: attached ? { id: attached.id } : null, visitKind, techId: past.techId, date: past.date, arrive: past.arrive,
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
      {doing !== "upcoming" && cards === "visit" && <VisitKindCards value={visitKind} onChange={pickKind} />}
      {doing !== "upcoming" && !canLogPast && <p data-testid="past-admin-only" className="text-sm text-amber-900">Only an admin can log or correct a past visit.</p>}
      {doing === "correct" && <VisitList visits={visits} correctId={correctId} onCorrect={pickVisit} />}
      {doing === "past" && visits.length > 0 && <VisitList visits={visits} />}
      {doing !== "upcoming" && canLogPast && <PastVisitFields techs={techs.data || []} value={past} onChange={setPast} />}
      {doing !== "upcoming" && (
        <Button className="h-11 w-full bg-[#C2410C] text-white hover:bg-[#9A3412]" disabled={busy || !canLogPast || !visitKind || !past.techId || !past.date || !past.arrive} onClick={save} data-testid="logged-work-save">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{doing === "correct" ? "Save correction" : "Save visit"}
        </Button>
      )}
    </div>
  );
}

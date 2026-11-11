import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Pencil, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useDispatchTechnicians } from "@/hooks/useDispatchTechnicians";
import TechPickerMessage from "@/components/jobs/TechPickerMessage";
import { JobVisitsCardView, VisitsEditor, useJobVisits } from "@/components/jobs/JobVisits";
import {
  RETURN_REASONS, returnVisitDraft, returnVisitNote, sortVisits, visitsChanged, visitsError, visitsPayload,
  type JobVisit, type ReturnReason,
} from "@/lib/jobVisits";

export type VisitPerms = { admin: boolean; rep: boolean };
const todayJhb = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

/** Edit a schedule's visits. mode "return" opens with a blank-date return visit and an optional reason (no default). */
export function VisitsSheet({ open, onOpenChange, visits, perms, mode, companyId, save, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; visits: JobVisit[]; perms: VisitPerms; mode: "edit" | "return";
  companyId?: string | null; save: (payload: ReturnType<typeof visitsPayload>) => Promise<string | null>; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<JobVisit[]>(() => (mode === "return" ? [...visits, returnVisitDraft(visits)] : visits));
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const techs = useDispatchTechnicians(companyId, open && perms.admin);
  // The return visit is the one unsaved row we added; its note follows the reason picker.
  const final = mode === "return"
    ? rows.map((v, i) => (i === rows.length - 1 && !v.id ? { ...v, note: returnVisitNote(reason, other) } : v))
    : rows;
  const submit = async () => {
    const err = visitsError(final);
    if (err) { toast({ title: err, variant: "destructive" }); return; }
    if (!visitsChanged(visits, final)) { onOpenChange(false); return; }
    setBusy(true);
    const e = await save(visitsPayload(final, perms.admin));
    setBusy(false);
    if (e) { toast({ title: "Couldn't save visits", description: e, variant: "destructive" }); return; }
    toast({ title: mode === "return" ? "Return visit added" : "Visits saved" });
    onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{mode === "return" ? "Add return visit" : "Visits"}</DialogTitle></DialogHeader>
        {mode === "return" && (
          <div className="space-y-2 rounded-xl border p-3" data-testid="return-reason">
            <Label htmlFor="rv-reason">Reason (optional)</Label>
            <select id="rv-reason" data-testid="return-reason-select" className="w-full min-h-[44px] rounded-md border bg-background px-2 text-sm"
              value={reason} onChange={(e) => setReason(e.target.value as ReturnReason | "")}>
              <option value="">No reason</option>
              {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reason === "Other" && <Input aria-label="Other reason" placeholder="What's the return visit for?" maxLength={480} value={other} onChange={(e) => setOther(e.target.value)} />}
            <p className="text-xs text-muted-foreground">Pick a date for the new visit below. The reason is saved in the visit note.</p>
          </div>
        )}
        <VisitsEditor visits={final} onChange={setRows} admin={perms.admin} canAdd={perms.admin || perms.rep} canNote={(perms.admin || perms.rep) && mode === "edit"}
          techs={techs.phase === "ready" ? (techs.data ?? []) : []} techPhase={perms.admin ? techs.phase : "ready"} onRetryTechs={() => { void techs.refetch(); }} today={todayJhb()} />
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="min-h-11 flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="min-h-11 flex-1" disabled={busy} onClick={submit} data-testid="visits-save">{busy ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VisitActions({ count, canEdit, onEdit, onReturn }: { count: number; canEdit: boolean; onEdit: () => void; onReturn: () => void }) {
  if (!canEdit) return null;
  return (
    <div className="flex gap-2 pt-1">
      <Button variant="outline" size="sm" className="min-h-11 flex-1" onClick={onEdit} data-testid="visits-edit">
        {count ? <><Pencil className="mr-1 h-4 w-4" />Edit visits</> : <><CalendarPlus className="mr-1 h-4 w-4" />Add visit</>}
      </Button>
      {count > 0 && (
        <Button variant="outline" size="sm" className="min-h-11 flex-1" onClick={onReturn} data-testid="add-return-visit">
          <RotateCcw className="mr-1 h-4 w-4" />Add return visit
        </Button>
      )}
    </div>
  );
}

/** Sales booking (lead, no job yet): its visits are job_schedules rows on the lead. */
export default function BookingVisitsCard({ leadId, perms, companyId, seed, onSaved, returnToken = 0 }: {
  leadId: string; perms: VisitPerms; companyId?: string | null; seed?: { date: string | null; time: string | null }; onSaved?: () => void;
  /** Bumps when More → Return visit is chosen. */
  returnToken?: number;
}) {
  const [sheet, setSheet] = useState<null | "edit" | "return">(null);
  useEffect(() => { if (returnToken) setSheet("return"); }, [returnToken]);
  const q = useQuery({
    queryKey: ["booking-visits", leadId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("booking_visits", { p_lead: leadId });
      if (error) throw error;
      return sortVisits((data ?? []) as JobVisit[]);
    },
  });
  if (q.isLoading || q.isError) return null;
  const visits = q.data ?? [];
  const canEdit = perms.admin || perms.rep;
  if (!visits.length && !canEdit) return null;
  // No rows yet: seed one from the booking's date/time so the first save creates visit 1.
  const t = (seed?.time ?? "08:00").slice(0, 5);
  const seeded: JobVisit[] = visits.length ? visits
    : seed?.date ? [{ id: null, date: seed.date, start: t, end: `${String(Math.min(23, +t.slice(0, 2) + 3)).padStart(2, "0")}:${t.slice(3, 5)}`, note: null }] : [];
  const actions = <VisitActions count={visits.length} canEdit={canEdit} onEdit={() => setSheet("edit")} onReturn={() => setSheet("return")} />;
  return (
    <>
      {visits.length ? <JobVisitsCardView visits={visits} actions={actions} /> : (
        <Card className="rounded-2xl" data-testid="job-visits-card"><CardContent className="space-y-2 p-4">
          <p className="text-sm font-semibold">Visits</p>
          <p className="text-sm text-muted-foreground">No visits scheduled yet. Add one per day if this needs more than one trip.</p>
          {actions}
        </CardContent></Card>
      )}
      {sheet && <VisitsSheet key={sheet} open onOpenChange={(o) => !o && setSheet(null)} visits={sheet === "edit" ? seeded : visits} perms={perms} mode={sheet} companyId={companyId}
        save={async (p) => { const { error } = await (supabase.rpc as any)("set_booking_visits", { p_lead: leadId, p_visits: p }); return error?.message ?? null; }}
        onSaved={() => { void q.refetch(); onSaved?.(); }} />}
    </>
  );
}

/** Job page: visits card with Edit (opens the job edit sheet) and Add return visit. Hides itself with no visits. */
export function JobVisitsSection({ jobId, companyId, perms, onEdit }: { jobId: string; companyId?: string | null; perms: VisitPerms; onEdit: () => void }) {
  const q = useJobVisits(jobId);
  const [ret, setRet] = useState(false);
  const visits = q.data ?? [];
  if (!visits.length) return null;
  const canEdit = perms.admin || perms.rep;
  return (
    <>
      <JobVisitsCardView visits={visits} actions={<VisitActions count={visits.length} canEdit={canEdit} onEdit={onEdit} onReturn={() => setRet(true)} />} />
      {ret && <VisitsSheet open onOpenChange={setRet} visits={visits} perms={perms} mode="return" companyId={companyId}
        save={async (p) => { const { error } = await (supabase.rpc as any)("set_job_visits", { p_job: jobId, p_visits: p, p_note: null }); return error?.message ?? null; }}
        onSaved={() => void q.refetch()} />}
    </>
  );
}

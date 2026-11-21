import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { jhbLocalToIso } from "@/lib/jobActionBar";
import { checkKindOf, type CheckKind } from "@/lib/materialCheck";
import { useJobVisits } from "@/components/jobs/JobVisits";
import {
  bookedDiffersFromQuote, lineDrawsStock, materialFact, materialsWritePlan, newVisitSeed,   quoteLinesFromPackAndPlan, scheduleWritePlan, startingMaterialLines, stockMatch, validateVisits, visitLabel,
  type ApplyMode, type BookedMaterial, type ExistingVisit, type MaterialLine, type VisitInput,
} from "@/lib/completeJobBookings";

const jhb = (iso: string | null | undefined, kind: "date" | "time") => {
  const d = iso ? new Date(iso) : new Date();
  return kind === "date"
    ? d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" })
    : d.toLocaleTimeString("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });
};

function useRefresh(jobId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["job-detail", jobId] });
    qc.invalidateQueries({ queryKey: ["job-activity", jobId] });
    qc.invalidateQueries({ queryKey: ["job-visits", jobId] });
    qc.invalidateQueries({ queryKey: ["complete-job-materials", jobId] });
    qc.invalidateQueries({ queryKey: ["job-materials-plan", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["dispatch-schedules"] });
    qc.invalidateQueries({ queryKey: ["dispatch-cards"] });
  };
}

export type CompleteFixtures = {
  visits: ExistingVisit[];
  quote: MaterialLine[];
  booked: BookedMaterial[];
  kind: CheckKind;
  stock?: { id?: string; item?: string | null; stock_unit?: string | null }[];
};

/** Admin: mark a job completed at a past date/time, and book the days and materials. Quiet: no alerts, no balance invoice. */
export function MarkCompletedDialog({ jobId, open, onOpenChange, suggestedAt, fixtures, seedVisits, materialsDefaultOpen = false }:
  { jobId: string; open: boolean; onOpenChange: (o: boolean) => void; suggestedAt?: string | null; fixtures?: CompleteFixtures; seedVisits?: VisitInput[]; materialsDefaultOpen?: boolean }) {
  const { toast } = useToast();
  const refresh = useRefresh(jobId);
  const past = suggestedAt && new Date(suggestedAt) < new Date() ? suggestedAt : null;
  const [date, setDate] = useState(jhb(past, "date"));
  const [time, setTime] = useState(jhb(past, "time"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ApplyMode | null>(null);
  const [materialsMode, setMaterialsMode] = useState<ApplyMode | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(materialsDefaultOpen);
  const loadedVisits = useJobVisits(jobId, open && !fixtures);
  const loadedMaterials = useCompleteMaterials(jobId, open && !fixtures);
  const existing = fixtures?.visits ?? loadedVisits.data ?? [];
  const kind = fixtures?.kind ?? loadedMaterials.data?.kind ?? "installation";
  const quote = fixtures?.quote ?? loadedMaterials.data?.quote ?? [];
  const booked = fixtures?.booked ?? loadedMaterials.data?.booked ?? [];
  const stock = fixtures?.stock ?? loadedMaterials.data?.stock ?? [];
  const started = startingMaterialLines(kind, quote, booked);
  const [days, setDays] = useState<VisitInput[] | null>(seedVisits ?? null);
  const [lines, setLines] = useState<MaterialLine[] | null>(fixtures ? started.lines : null);
  useEffect(() => {
    if (days || fixtures || seedVisits || !loadedVisits.isFetched) return;
    setDays([newVisitSeed(loadedVisits.data ?? [], date)]);
  }, [days, fixtures, seedVisits, loadedVisits.isFetched, loadedVisits.data, date]);
  useEffect(() => {
    if (lines || fixtures || !loadedMaterials.isFetched) return;
    const next = startingMaterialLines(loadedMaterials.data?.kind ?? "installation", loadedMaterials.data?.quote ?? [], loadedMaterials.data?.booked ?? []);
    setLines(next.lines);
  }, [lines, fixtures, loadedMaterials.isFetched, loadedMaterials.data]);
  const visitRows = days ?? seedVisits ?? [newVisitSeed(existing, date)];
  const materialRows = lines ?? started.lines;
  const setVisit = (i: number, patch: Partial<VisitInput>) => setDays(visitRows.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const setLine = (i: number, patch: Partial<MaterialLine>) => setLines(materialRows.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const materialsDiffer = bookedDiffersFromQuote(quote, booked);

  const save = async () => {
    const at = jhbLocalToIso(date, time);
    if (!at) { toast({ title: "Pick a date and time", variant: "destructive" }); return; }
    const shape = validateVisits(visitRows, date);
    if (shape) { toast({ title: shape, variant: "destructive" }); return; }
    const schedule = scheduleWritePlan(existing, visitRows, existing.length ? scheduleMode : null);
    if (schedule.error) { toast({ title: schedule.error, variant: "destructive" }); return; }
    let materialsPayload: ReturnType<typeof materialsPayloadOf> | null = null;
    if (materialsOpen) {
      const plan = materialsWritePlan(materialRows, booked, booked.length ? materialsMode : null);
      if (plan.error) { toast({ title: plan.error, variant: "destructive" }); return; }
      materialsPayload = materialsPayloadOf(plan.insert);
    }
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("admin_mark_job_completed", {
      p_job: jobId, p_at: at, p_note: note || null,
      p_visits: schedule.insert.map((v) => ({ date: v.date, start: v.start, end: v.end })),
      p_schedule_mode: existing.length ? scheduleMode : null,
      p_materials: materialsPayload,
      p_materials_mode: materialsOpen && booked.length ? materialsMode : null,
    });
    setBusy(false);
    if (error) { toast({ title: "Couldn't mark completed", description: error.message, variant: "destructive" }); return; }
    const clashes = Array.isArray(data?.clashes) ? data.clashes.length : 0;
    toast({
      title: "Job marked completed",
      description: clashes
        ? `No client or rep alerts were sent. ${clashes} of these times also overlap another booking. That booking stays on its own job.`
        : "No client or rep alerts were sent.",
    });
    refresh();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="mark-completed-dialog">
        <DialogHeader>
          <DialogTitle>Mark job completed</DialogTitle>
          <DialogDescription>When was the work finished? This is logged. No client or rep alerts are sent, and the balance invoice is not raised automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="block" htmlFor="mc-date">Date</Label><Input id="mc-date" type="date" value={date} max={jhb(null, "date")} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label className="block" htmlFor="mc-time">Time</Label><TimeInput24 id="mc-time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>

        {existing.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30" data-testid="existing-bookings">
            <p className="font-semibold text-amber-950 dark:text-amber-100">This job already has booking info.</p>
            <ul className="space-y-0.5 text-amber-950 dark:text-amber-100">
              {existing.map((v) => <li key={v.id}>{visitLabel(v.date, v.start, v.end)}</li>)}
            </ul>
            <ModeChoice name="schedule" mode={scheduleMode} onChange={setScheduleMode}
              addLabel="Keep what's booked and add these days"
              addHint="The days already booked stay as they are. The days below are added next to them."
              overrideHint="Replace the bookings on this job with the days below. Other jobs stay as they are." />
          </div>
        )}

        <div className="space-y-2" data-testid="complete-days">
          <div className="text-sm font-medium">Days to book</div>
          {visitRows.map((v, i) => (
            <div key={`day-${i}`} className="space-y-2 rounded-xl border p-3" data-testid="complete-day">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day {i + 1}</span>
                {visitRows.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-destructive" aria-label={`Remove day ${i + 1}`} onClick={() => setDays(visitRows.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 items-end">
                <div className="col-span-2 space-y-1"><label className="block text-xs text-muted-foreground" htmlFor={`cd-${i}`}>Date</label>
                  <Input id={`cd-${i}`} type="date" value={v.date} max={date} onChange={(e) => setVisit(i, { date: e.target.value })} /></div>
                <div className="space-y-1"><label className="block text-xs text-muted-foreground" htmlFor={`cs-${i}`}>Start</label>
                  <TimeInput24 id={`cs-${i}`} value={v.start} onChange={(e) => setVisit(i, { start: e.target.value })} /></div>
                <div className="space-y-1"><label className="block text-xs text-muted-foreground" htmlFor={`ce-${i}`}>End</label>
                  <TimeInput24 id={`ce-${i}`} value={v.end} onChange={(e) => setVisit(i, { end: e.target.value })} /></div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" className="w-full min-h-[44px]" data-testid="add-complete-day" onClick={() => setDays([...visitRows, newVisitSeed(visitRows.map((v, i) => ({ id: `n${i}`, ...v })), date)])}>
            <Plus className="mr-1 h-4 w-4" />Add another day
          </Button>
        </div>

        <details className="rounded-xl border" data-testid="materials-section" open={materialsOpen} onToggle={(e) => setMaterialsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 text-sm font-medium">
            <span>Materials and stock{quote.length ? ` · ${quote.length} on the quote` : ""}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </summary>
          <div className="space-y-3 border-t px-3 py-3">
            {started.note && <p className="text-sm text-muted-foreground" data-testid="materials-note">{started.note}</p>}
            {booked.length > 0 && (
              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30" data-testid="existing-materials">
                <p className="font-semibold text-amber-950 dark:text-amber-100">
                  {materialsDiffer ? "This job already has materials and stock booked, and it is not the same as the quote." : "This job already has these materials and stock booked."}
                </p>
                <ul className="space-y-0.5 text-amber-950 dark:text-amber-100">
                  {booked.map((b) => <li key={b.id}>{materialFact(b)}</li>)}
                </ul>
                <ModeChoice name="materials" mode={materialsMode} onChange={setMaterialsMode}
                  addLabel="Keep what's booked and add these items"
                  addHint="What is already drawn or reserved stays. Only items that are not already booked are drawn off stock."
                  overrideHint="Replace the materials and reserved stock on this job with the list below, and update the on-hand quantities. Other jobs stay as they are." />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{kind === "service" ? "Extra parts on this job. Repair gas is not invented." : "From the quote. Units are recorded. Materials and parts are drawn off stock."}</p>
            {materialRows.map((l, i) => (
              <div key={l.key} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2" data-testid="material-line">
                <div className="space-y-1">
                  <label className="block text-xs text-muted-foreground" htmlFor={`mi-${i}`}>{l.kind === "unit" ? "Unit" : "Item"}{l.unit ? ` (${l.unit})` : ""}{lineDrawsStock(l) ? " · draws stock" : ""}</label>
                  <Input id={`mi-${i}`} value={l.item} maxLength={160} onChange={(e) => {
                    const item = e.target.value;
                    const hit = stockMatch(item, stock);
                    setLine(i, hit && l.kind !== "unit"
                      ? { item, stockItemId: hit.id ?? null, unit: hit.stock_unit ?? l.unit, kind: "material" }
                      : { item, ...(l.kind === "part" && !hit ? { stockItemId: null } : {}) });
                  }} />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-muted-foreground" htmlFor={`mq-${i}`}>Qty</label>
                  <Input id={`mq-${i}`} inputMode="decimal" value={l.qty ?? ""} onChange={(e) => setLine(i, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
                <Button type="button" size="sm" variant="ghost" className="h-9 px-2 text-destructive" aria-label={`Remove ${l.item || "item"}`} onClick={() => setLines(materialRows.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full min-h-[44px]" data-testid="add-material" onClick={() => setLines([...materialRows, { key: `new-${materialRows.length}-${Date.now()}`, item: "", qty: 1, unit: null, kind: "part" }])}>
              <Plus className="mr-1 h-4 w-4" />Add an item
            </Button>
          </div>
        </details>

        <div className="space-y-1"><Label htmlFor="mc-note">Note (optional)</Label><Textarea id="mc-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Installed on the day, tech forgot to close it" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={save} disabled={busy} data-testid="mark-completed-save">
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Mark completed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeChoice({ name, mode, onChange, addLabel, addHint, overrideHint }: {
  name: string; mode: ApplyMode | null; onChange: (m: ApplyMode) => void; addLabel: string; addHint: string; overrideHint: string;
}) {
  return (
    <fieldset className="space-y-2" data-testid={`${name}-choice`}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-amber-950/80 dark:text-amber-100/80">Add or replace</legend>
      <label className="flex items-start gap-2">
        <input className="mt-1" type="radio" name={name} value="keep_add" checked={mode === "keep_add"} onChange={() => onChange("keep_add")} data-testid={`${name}-keep`} />
        <span><span className="font-medium">{addLabel}</span><span className="block text-xs text-amber-950/80 dark:text-amber-100/80">{addHint}</span></span>
      </label>
      <label className="flex items-start gap-2">
        <input className="mt-1" type="radio" name={name} value="override" checked={mode === "override"} onChange={() => onChange("override")} data-testid={`${name}-override`} />
        <span><span className="font-medium">Complete override</span><span className="block text-xs text-amber-950/80 dark:text-amber-100/80">{overrideHint}</span></span>
      </label>
    </fieldset>
  );
}

function materialsPayloadOf(lines: MaterialLine[]) {
  return lines.map((l) => ({
    item: l.item.trim(), qty: l.qty, unit: l.unit, stock_item_id: l.stockItemId ?? null, quote_item_id: l.quoteItemId ?? null, kind: l.kind,
  }));
}

function useCompleteMaterials(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["complete-job-materials", jobId],
    enabled: enabled && !!jobId,
    queryFn: async () => {
      const [planRes, packRes, bookedRes, jobRes] = await Promise.all([
        (supabase.rpc as any)("job_materials_plan", { p_job: jobId }),
        (supabase.rpc as any)("get_job_packing_list", { p_job_id: jobId }),
        (supabase.rpc as any)("job_booked_materials", { p_job: jobId }),
        supabase.from("jobs").select("job_type, title").eq("id", jobId).maybeSingle(),
      ]);
      const job = jobRes.data as { job_type?: string | null; title?: string | null } | null;
      const kind = checkKindOf({ jobType: job?.job_type, title: job?.title });
      const plan = planRes.error ? null : planRes.data;
      const quote = quoteLinesFromPackAndPlan(packRes.error ? [] : (packRes.data ?? []), plan);
      const booked = (bookedRes.error ? [] : (bookedRes.data ?? [])) as BookedMaterial[];
      return { kind, quote, booked, stock: (plan?.stock ?? []) as { id?: string; item?: string | null; stock_unit?: string | null }[] };
    },
  });
}

/** Admin: reopen a completed job. Logged; quiet. */
export function ReopenJobDialog({ jobId, open, onOpenChange }: { jobId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const refresh = useRefresh(jobId);
  const [status, setStatus] = useState<"in_progress" | "scheduled">("in_progress");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)("admin_reopen_job", { p_job: jobId, p_status: status, p_note: note || null });
    setBusy(false);
    if (error) { toast({ title: "Couldn't reopen", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Job reopened" });
    refresh(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="reopen-dialog">
        <DialogHeader><DialogTitle>Reopen job</DialogTitle><DialogDescription>The completed date is cleared. This is logged.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["in_progress", "scheduled"] as const).map((s) => (
            <Button key={s} variant={status === s ? "default" : "outline"} className="min-h-[44px]" onClick={() => setStatus(s)}>{s === "in_progress" ? "In progress" : "Scheduled"}</Button>
          ))}
        </div>
        <div className="space-y-1"><Label htmlFor="ro-note">Reason (optional)</Label><Textarea id="ro-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Reopen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

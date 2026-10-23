/**
 * Phase (b) — tech's day-by-day view of a multi-day job: the run's days with their state, one big button for today
 * ("Day 2 of 3 · Check in" → "Done for today" → "Day done", last day "Job complete"), the Done-for-today sheet
 * (hours prefilled from the check-in time, editable; a note when changed; day notes) and "Add a day".
 * Check in / Done for today / En route also work offline: queued with the tap time (sync op 'job_day').
 * POPIA: job_days only returns the caller's company and techs only see their own entries (RLS + RPC checks).
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Car, CheckCircle2, CircleDot, Clock, Loader2, LogIn, Minus, Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { planText, type EnRoutePlan } from "@/lib/jobWatch";
import {
  addJobDay, autoHours, dayAction, dayLabel, DAY_STATE_TEXT, doneForTodayError, hoursNeedNote, hoursText, loadJobDays, runDayOp,
  type DayOp, type DayOpArgs, type JobDay, type JobDays,
} from "@/lib/jobDays";

export const todaySAST = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const cacheKey = (id: string) => `job-days:${id}`;

/** job_days for one job; the last copy is kept on the device so the panel still shows offline. */
export function useJobDays(jobId: string, enabled = true) {
  const { isOnline } = useOfflineContext();
  return useQuery({
    queryKey: ["job-days", jobId],
    enabled: !!jobId && enabled,
    networkMode: "always",
    initialData: () => {
      try { const s = localStorage.getItem(cacheKey(jobId)); return s ? (JSON.parse(s) as JobDays) : undefined; } catch { return undefined; }
    },
    queryFn: async () => {
      if (!isOnline) {
        const s = localStorage.getItem(cacheKey(jobId));
        if (s) return JSON.parse(s) as JobDays;
      }
      const d = await loadJobDays(jobId);
      try { localStorage.setItem(cacheKey(jobId), JSON.stringify(d)); } catch { /* storage full */ }
      return d;
    },
  });
}

/** Applies a tap to the cached days so the button moves on at once (also while offline). */
export function applyDayOp(d: JobDays, fn: DayOp, at: string, today: string, hours?: number | null, notes?: string | null): JobDays {
  const days = d.days.map((x): JobDay => {
    if (x.date !== today) return x;
    if (fn === "tech_day_en_route") return { ...x, en_route_at: x.en_route_at ?? at, state: x.checked_in_at ? x.state : "en_route" };
    if (fn === "tech_check_in") return { ...x, checked_in_at: x.checked_in_at ?? at, state: "on_site" };
    return { ...x, checked_out_at: at, hours: hours ?? x.hours, notes: notes ?? x.notes, state: "done" };
  });
  return { ...d, status: fn === "tech_check_in" && d.status !== "completed" ? "in_progress" : d.status, days, labour_hours: days.reduce((s, x) => s + Number(x.hours || 0), 0) };
}

export function useDayOps(jobId: string) {
  const { isOnline, queueOperation } = useOfflineContext();
  const qc = useQueryClient();
  return async (fn: DayOp, extra: Omit<DayOpArgs, "p_job_id" | "p_at"> = {}): Promise<{ queued: boolean; result?: Record<string, any> }> => {
    const at = new Date().toISOString();
    const args: DayOpArgs = { p_job_id: jobId, p_at: at, ...extra };
    const prev = qc.getQueryData<JobDays>(["job-days", jobId]);
    const today = prev?.today && isOnline ? prev.today : todaySAST();
    if (!isOnline) {
      await queueOperation("job_day", "job_time_entries", `${jobId}:${fn}:${at}`, { fn, args });
      if (prev) {
        const next = applyDayOp(prev, fn, at, today, extra.p_hours ?? null, extra.p_notes ?? null);
        qc.setQueryData(["job-days", jobId], next);
        try { localStorage.setItem(cacheKey(jobId), JSON.stringify(next)); } catch { /* ignore */ }
      }
      return { queued: true };
    }
    const result = await runDayOp(fn, args);
    await qc.invalidateQueries({ queryKey: ["job-days", jobId] });
    return { queued: false, result };
  };
}

const STATE_TONE: Record<string, string> = {
  done: "bg-green-600 text-white",
  on_site: "bg-primary text-primary-foreground",
  en_route: "bg-amber-200 text-amber-950 dark:bg-amber-500/25 dark:text-amber-200",
  missed: "bg-destructive text-destructive-foreground",
  not_needed: "bg-muted text-muted-foreground line-through",
  today: "border border-primary text-primary",
  upcoming: "bg-muted text-muted-foreground",
};

type ViewProps = {
  data: JobDays;
  today: string;
  busy?: boolean;
  offline?: boolean;
  enRouteHint?: string | null;
  onEnRoute?: () => void;
  onAction?: (kind: ReturnType<typeof dayAction>["kind"]) => void;
  onAddDay?: () => void;
};

/** Pure view (harness + tests). */
export function JobDaysView({ data, today, busy, offline, enRouteHint, onEnRoute, onAction, onAddDay }: ViewProps) {
  const act = dayAction(data, today);
  const todayDay = data.days.find((x) => x.date === today);
  const showEnRoute = !!todayDay && !todayDay.en_route_at && !todayDay.checked_in_at && !todayDay.checked_out_at && !["completed", "cancelled"].includes(data.status);
  const closed = ["completed", "cancelled"].includes(data.status);
  return (
    <Card data-testid="job-days-panel">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">{data.day_count}-day job</h2>
          <span className="text-sm text-muted-foreground" data-testid="job-days-labour">Logged {hoursText(data.labour_hours)}</span>
        </div>
        {offline && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            <WifiOff className="h-4 w-4" />Offline: your taps are saved with the time and sync later.</p>
        )}
        <ol className="divide-y rounded-lg border" data-testid="job-days-list">
          {data.days.map((d) => (
            <li key={d.schedule_id} className={cn("flex items-center gap-3 px-3 py-2.5", d.date === today && "bg-primary/5")}>
              <span className="w-12 shrink-0 text-sm font-bold tabular-nums">Day {d.day_index}</span>
              <span className="min-w-0 flex-1 text-sm">
                {dayLabel(d.date)}{d.date === today && <b className="text-primary"> · today</b>}
                <span className="block text-xs text-muted-foreground">
                  {d.hours != null ? `${hoursText(d.hours)}${d.hours_edit_note ? ` · ${d.hours_edit_note}` : ""}` : d.start ? `${d.start}–${d.end}` : ""}
                  {d.notes ? ` · ${d.notes}` : ""}
                </span>
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATE_TONE[d.state])}>{DAY_STATE_TEXT[d.state] ?? d.state}</span>
            </li>
          ))}
        </ol>

        {showEnRoute && onEnRoute && (
          <div className="space-y-1">
            <Button variant="outline" className="h-12 w-full gap-2 text-base" disabled={busy} onClick={onEnRoute} data-testid="day-en-route">
              <Car className="h-5 w-5" />I'm en route
            </Button>
            {enRouteHint && <p className="text-center text-xs text-muted-foreground">{enRouteHint}</p>}
          </div>
        )}

        {act.kind !== "none" ? (
          <div className="space-y-1">
            <Button
              className={cn("h-14 w-full gap-2 text-lg font-bold",
                act.kind === "job_complete" && "bg-green-600 text-white hover:bg-green-700",
                act.kind === "day_done" && "bg-muted text-foreground hover:bg-muted")}
              disabled={busy || act.kind === "day_done"} onClick={() => onAction?.(act.kind)} data-testid={`day-action-${act.kind}`}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" />
                : act.kind === "check_in" ? <LogIn className="h-5 w-5" />
                : act.kind === "done_for_today" ? <Clock className="h-5 w-5" />
                : <CheckCircle2 className="h-5 w-5" />}
              {act.label}
            </Button>
            {act.sub && <p className="text-center text-sm text-muted-foreground" data-testid="day-action-sub">{act.sub}</p>}
          </div>
        ) : act.label ? (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-muted p-3 text-sm" data-testid="day-action-none">
            <CircleDot className="h-4 w-4" />{act.label}{act.sub ? ` · ${act.sub}` : ""}</p>
        ) : null}

        {!closed && onAddDay && (
          <Button variant="ghost" className="h-11 w-full gap-2" disabled={busy || offline} onClick={onAddDay} data-testid="day-add">
            <CalendarPlus className="h-4 w-4" />Need another day?
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

type SheetProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tag: string;
  auto: number;
  busy?: boolean;
  onSubmit: (v: { hours: number; notes: string; editNote: string }) => void;
};

/** "Done for today": hours prefilled from the check-in time, editable in 0.25 h steps; a note when changed. */
export function DoneForTodaySheet({ open, onOpenChange, tag, auto, busy, onSubmit }: SheetProps) {
  const [hours, setHours] = useState(auto);
  const [notes, setNotes] = useState("");
  const [editNote, setEditNote] = useState("");
  useEffect(() => { if (open) { setHours(auto); setNotes(""); setEditNote(""); } }, [open, auto]);
  const changed = hoursNeedNote(hours, auto);
  const err = doneForTodayError(hours, auto, editNote);
  const step = (d: number) => setHours((h) => Math.max(0, Math.min(16, Math.round((h + d) * 4) / 4)));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[94vh] overflow-y-auto p-4 sm:mx-auto sm:max-w-lg" data-testid="done-today-sheet">
        <SheetHeader className="mb-3 text-left">
          <SheetTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Done for today · {tag}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4">
          <section className="space-y-2">
            <Label className="text-base font-semibold">Hours on site today</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="h-12 w-12" aria-label="Less" onClick={() => step(-0.25)}><Minus className="h-5 w-5" /></Button>
              <Input type="number" inputMode="decimal" step="0.25" min="0" max="16" className="h-12 w-24 text-center text-xl font-bold"
                value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Hours" data-testid="done-hours" />
              <Button type="button" variant="outline" size="icon" className="h-12 w-12" aria-label="More" onClick={() => step(0.25)}><Plus className="h-5 w-5" /></Button>
              <span className="text-sm text-muted-foreground">From check-in: {hoursText(auto)}</span>
            </div>
          </section>
          {changed && (
            <section className="space-y-1">
              <Label htmlFor="edit-note" className="text-base font-semibold">Why are the hours different?</Label>
              <Input id="edit-note" className="h-11" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="e.g. forgot to check in, stayed for commissioning" data-testid="done-edit-note" />
            </section>
          )}
          <section className="space-y-1">
            <Label htmlFor="day-notes" className="text-base font-semibold">Day notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="day-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What got done, what's left for tomorrow…" data-testid="done-notes" />
          </section>
          {err && <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="done-error">{err}</p>}
          <Button className="h-14 w-full text-lg font-bold" disabled={!!err || busy} onClick={() => onSubmit({ hours, notes: notes.trim(), editNote: editNote.trim() })} data-testid="done-submit">
            {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}Save · Day done
          </Button>
          <p className="pb-2 text-center text-xs text-muted-foreground">The job stays open. Day hours are not billed to the client.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Container used on /field/jobs/:id for multi-day jobs. */
export default function JobDaysPanel({ jobId, onCompleteJob, onChanged }: { jobId: string; onCompleteJob: (d: JobDays) => void; onChanged?: () => void }) {
  const { toast } = useToast();
  const { isOnline } = useOfflineContext();
  const days = useJobDays(jobId);
  const run = useDayOps(jobId);
  const [busy, setBusy] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const d = days.data;
  const today = d?.today && isOnline ? d.today : todaySAST();
  const todayDay = d?.days.find((x) => x.date === today);
  const plan = useQuery({
    queryKey: ["job-day-plan", jobId, today],
    enabled: isOnline && !!todayDay && !todayDay.en_route_at && !todayDay.checked_in_at,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)("job_day_en_route_plan", { p_job_id: jobId, p_date: today });
      return (data ?? null) as EnRoutePlan | null;
    },
  });
  if (!d || !d.multi_day) return null;

  const go = async (fn: DayOp, extra: Omit<DayOpArgs, "p_job_id" | "p_at"> = {}, ok?: string) => {
    setBusy(true);
    try {
      const r = await run(fn, extra);
      if (r.queued) toast({ title: "Saved offline", description: "It will sync with the time you tapped." });
      else if (ok) toast({ title: r.result?.already ? "Already done for today" : ok });
      onChanged?.();
      return true;
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    } finally { setBusy(false); }
  };

  const addDay = async () => {
    setBusy(true);
    try {
      const r = await addJobDay(jobId);
      if (r.ok) toast({ title: `Day ${r.day_index} added`, description: `${dayLabel(r.date!)} · now ${r.day_count} days` });
      else toast({ title: r.needs_office ? "The office will decide" : "Couldn't add a day", description: r.message });
      await days.refetch();
    } catch (e) {
      toast({ title: "Couldn't add a day", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <>
      <JobDaysView data={d} today={today} busy={busy} offline={!isOnline} enRouteHint={planText(plan.data)}
        onEnRoute={() => go("tech_day_en_route", {}, "Marked en route")}
        onAddDay={addDay}
        onAction={(kind) => {
          if (kind === "check_in") void go("tech_check_in", {}, "Checked in");
          else if (kind === "done_for_today") setDoneOpen(true);
          else if (kind === "job_complete") onCompleteJob(d);
        }} />
      <DoneForTodaySheet open={doneOpen} onOpenChange={setDoneOpen} busy={busy}
        tag={todayDay ? `Day ${todayDay.day_index} of ${todayDay.day_count}` : ""}
        auto={autoHours(todayDay?.checked_in_at)}
        onSubmit={async (v) => {
          const auto = autoHours(todayDay?.checked_in_at);
          const ok = await go("tech_done_for_today", {
            p_hours: v.hours, p_notes: v.notes || null, p_edit_note: hoursNeedNote(v.hours, auto) ? v.editNote : null,
          }, "Day done");
          if (ok) setDoneOpen(false);
        }} />
    </>
  );
}

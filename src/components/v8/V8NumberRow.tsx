import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useLeadInbox } from "@/hooks/useLeadInbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePipelineData } from "@/components/jobs/PipelineBoard";
import { buildDeals, fmtRandShort } from "@/lib/quotePipeline";
import { D1_TILE_LINKS, TILE_LINKS, filterLeadsByLane } from "@/lib/drilldown";
import { buildBoardRows, filterBoardRows, rowDate } from "@/lib/jobsBoard";
import { loadEntries, todayInJohannesburg } from "@/lib/todaysJobs";
import { isSettledPayment } from "@/lib/payments";
import { DAY, DEFAULT_GOALS, changeLabel, depositsWaiting, goalsFrom, limitTone, monthStart, quotesNotFollowedUp, weekStart, type Goals, type Tone } from "@/lib/dashboardNumbers";
import { cn } from "@/lib/utils";

export type Tile = { key: string; label: string; hint?: string; value: string; goal?: string; pct?: number; change: string; tone: Tone; to: string };

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-card",
  amber: "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
  red: "border-red-300 bg-red-50 dark:bg-red-950/30",
};
const BAR: Record<Tone, string> = { neutral: "bg-ink-muted", amber: "bg-amber-500", red: "bg-red-500" };

function useGoalsRow() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dashboard-goals", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const companyId = await getUserCompanyId(user?.id);
      if (!companyId) return null;
      const { data } = await (supabase.from("company_settings") as any).select("id, dashboard_goals").eq("company_id", companyId)
        .order("is_primary", { ascending: false }).order("updated_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      return data ? { id: data.id as string, companyId, goals: goalsFrom(data.dashboard_goals) } : { id: null, companyId, goals: DEFAULT_GOALS };
    },
    staleTime: 60000,
  });
}

/** R4: owner/admin number row. Neutral by default; amber close to a limit, red past it. Real data only. */
export default function V8NumberRow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const { data: pipe } = usePipelineData();
  const { leads: inbox } = useLeadInbox();
  const { data: g } = useGoalsRow();
  const goals = g?.goals || DEFAULT_GOALS;
  const [edit, setEdit] = useState(false);

  const { data: live } = useQuery({
    queryKey: ["v8-number-row", g?.companyId, todayInJohannesburg()],
    enabled: !!g?.companyId,
    refetchInterval: 60000,
    queryFn: async () => {
      const now = new Date();
      const m0 = monthStart(now), lm0 = new Date(m0.getFullYear(), m0.getMonth() - 1, 1);
      const lmSame = new Date(lm0.getTime() + (now.getTime() - m0.getTime()));
      const w0 = weekStart(now), lw0 = new Date(w0.getTime() - 7 * DAY), lwSame = new Date(now.getTime() - 7 * DAY);
      const y0 = new Date(now); y0.setHours(0, 0, 0, 0); const yd0 = new Date(y0.getTime() - DAY), ydSame = new Date(now.getTime() - DAY);
      const iso = (d: Date) => d.toISOString();
      const ymd = (d: Date) => todayInJohannesburg(d);
      const [pays, done, jobsRes, entries, leads] = await Promise.all([
        (supabase.from("payments") as any).select("amount, payment_date, status, gateway").eq("company_id", g!.companyId).gte("payment_date", ymd(lm0)),
        (supabase.from("jobs") as any).select("completed_at").eq("company_id", g!.companyId).gte("completed_at", iso(lw0)),
        supabase.from("jobs").select("id, status, scheduled_for, job_type, title, address, assignments(id, profile_id, status)").gte("scheduled_for", iso(lw0)),
        loadEntries({ from: ymd(lw0) }).catch(() => []),
        (supabase.from("leads") as any).select("id, primary_intent, service_type, source, notes, created_at").gte("created_at", iso(yd0)),
      ]);
      const settled = ((pays.data as any[]) || []).filter(isSettledPayment);
      const sum = (from: Date, to: Date) => settled.filter((p) => p.payment_date >= ymd(from) && p.payment_date <= ymd(to)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const doneAt = ((done.data as any[]) || []).map((j) => new Date(j.completed_at).getTime());
      const rows = filterBoardRows(buildBoardRows((jobsRes.data as any[]) || [], entries as any), { lane: "sales" }).filter((r) => !/cancel/i.test(r.status));
      const visits = (a: Date, b: Date) => rows.filter((r) => { const d = rowDate(r); return !!d && d >= ymd(a) && d <= ymd(b); }).length;
      const svc = filterLeadsByLane((leads.data as any[]) || [], "service").map((l) => new Date(l.created_at).getTime());
      return {
        revenue: sum(m0, now), revenueBefore: sum(lm0, lmSame),
        jobs: doneAt.filter((t) => t >= w0.getTime()).length, jobsBefore: doneAt.filter((t) => t >= lw0.getTime() && t <= lwSame.getTime()).length,
        visits: visits(w0, new Date(w0.getTime() + 6 * DAY)), visitsBefore: visits(lw0, new Date(w0.getTime() - DAY)),
        svcToday: svc.filter((t) => t >= y0.getTime()).length, svcYesterday: svc.filter((t) => t >= yd0.getTime() && t <= ydSame.getTime()).length,
      };
    },
  });

  const tiles = useMemo<Tile[]>(() => {
    const deals = pipe ? buildDeals(pipe.quotes as any, pipe.invoices as any, pipe.jobs as any) : [];
    const now = Date.now();
    const dep = depositsWaiting(deals as any, now), depBefore = depositsWaiting(deals as any, now - 7 * DAY);
    const fu = quotesNotFollowedUp(deals as any, now), fuBefore = quotesNotFollowedUp(deals as any, now - 7 * DAY);
    const pct = (v: number, goal: number) => (goal > 0 ? Math.min(100, Math.round((v / goal) * 100)) : 0);
    const L = live;
    return [
      { key: "deposits", label: "Installs awaiting deposit", value: String(dep), goal: `limit ${goals.depositLimit}`, change: changeLabel(dep, depBefore, "last week"), hint: "Accepted, deposit unpaid for more than 7 days", tone: limitTone(dep, goals.depositLimit), to: D1_TILE_LINKS.depositsDue },
      { key: "followup", label: "Quotes not followed up", value: String(fu), goal: `limit ${goals.followupLimit}`, change: changeLabel(fu, fuBefore, "last week"), hint: "Sent or viewed, no activity for 5+ days", tone: limitTone(fu, goals.followupLimit), to: "/admin/quotes?status=sent,viewed&type=estimate" },
      { key: "revenue", label: "Revenue this month", value: L ? fmtRandShort(L.revenue) : "…", goal: fmtRandShort(goals.revenueGoal), pct: L ? pct(L.revenue, goals.revenueGoal) : 0, change: L ? changeLabel(L.revenue, L.revenueBefore, "last month", fmtRandShort) : "", tone: "neutral", to: `/admin/invoices?state=paid&period=${todayInJohannesburg().slice(0, 7)}` },
      { key: "jobs", label: "Jobs completed this week", value: L ? String(L.jobs) : "…", goal: String(goals.jobsGoal), pct: L ? pct(L.jobs, goals.jobsGoal) : 0, change: L ? changeLabel(L.jobs, L.jobsBefore, "last week") : "", tone: "neutral", to: TILE_LINKS.jobsCompleted },
      { key: "visits", label: "Visits booked this week", value: L ? String(L.visits) : "…", goal: String(goals.visitsGoal), pct: L ? pct(L.visits, goals.visitsGoal) : 0, change: L ? changeLabel(L.visits, L.visitsBefore, "last week") : "", tone: "neutral", to: "/admin/jobs/dispatch?lane=sales&open=1" },
      { key: "service", label: "Service leads new today", value: L ? String(L.svcToday) : String(filterLeadsByLane(inbox as any[], "service").length), change: L ? changeLabel(L.svcToday, L.svcYesterday, "yesterday") : "", tone: "neutral", to: D1_TILE_LINKS.serviceLeads },
    ];
  }, [pipe, live, goals, inbox]);

  return (
    <>
      <NumberTiles tiles={tiles} canEdit={isAdmin} onOpen={(to) => navigate(to)} onEdit={() => setEdit(true)} />
      {edit && <GoalsDialog id={g?.id || null} goals={goals} onClose={() => setEdit(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["dashboard-goals"] }); setEdit(false); }} />}
    </>
  );
}

export function NumberTiles({ tiles, canEdit, onOpen, onEdit }: { tiles: Tile[]; canEdit: boolean; onOpen: (to: string) => void; onEdit: () => void }) {
  return (
    <div data-testid="v8-number-row" className="rounded-2xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">Numbers</span>
        {canEdit && <button type="button" className="inline-flex items-center gap-1 text-sm text-link" onClick={onEdit} data-testid="v8-goals-edit"><Settings2 className="h-4 w-4" />Goals</button>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <button key={t.key} type="button" onClick={() => onOpen(t.to)} title={t.hint} data-tone={t.tone} data-testid={`v8-tile-${t.key}`}
            className={cn("min-w-0 rounded-xl border p-2.5 text-left transition-colors hover:border-link", TONE[t.tone], t.tone !== "neutral" && "order-first md:order-none")}>
            <div className="line-clamp-2 min-h-[36px] text-xs leading-[18px] text-ink-secondary">{t.label}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className={cn("text-xl font-semibold tabular-nums", t.tone === "red" ? "text-red-700 dark:text-red-300" : t.tone === "amber" ? "text-amber-800 dark:text-amber-200" : "text-ink")}>{t.value}</span>
              {t.goal && <span className="truncate text-xs text-ink-muted">/ {t.goal}</span>}
            </div>
            {t.pct !== undefined && <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", BAR[t.tone])} style={{ width: `${t.pct}%` }} /></div>}
            <div className="mt-1 truncate text-xs text-ink-muted">{t.change}</div>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-ink-muted" />On track</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />Close to limit</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" />Past limit</span>
      </div>
    </div>
  );
}

const FIELDS: { k: keyof Goals; label: string }[] = [
  { k: "depositLimit", label: "Installs awaiting deposit >7 days: limit" },
  { k: "followupLimit", label: "Quotes not followed up >5 days: limit" },
  { k: "revenueGoal", label: "Revenue goal this month (R)" },
  { k: "jobsGoal", label: "Jobs completed per week: goal" },
  { k: "visitsGoal", label: "Visits booked per week: goal" },
];

function GoalsDialog({ id, goals, onClose, onSaved }: { id: string | null; goals: Goals; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.k, String(goals[f.k])])));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!id) { setErr("Company settings not found."); return; }
    setBusy(true);
    const { error } = await (supabase.from("company_settings") as any).update({ dashboard_goals: goalsFrom(v) }).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message); else onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Goals and limits</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {FIELDS.map((f) => (
            <label key={f.k} className="flex items-center justify-between gap-2 text-sm text-ink-secondary">
              <span>{f.label}</span>
              <Input type="number" min={0} inputMode="numeric" className="h-9 w-28 text-right" value={v[f.k]} onChange={(e) => setV((s) => ({ ...s, [f.k]: e.target.value }))} />
            </label>
          ))}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button onClick={save} disabled={busy}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

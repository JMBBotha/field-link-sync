import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Inbox, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { cn } from "@/lib/utils";
import { EmptyNote } from "@/components/dashboard/v7/V7Dashboard";
import { periodRange, type PeriodKind } from "@/lib/dashboardV7";

/** v7 top row (Johan call 14:03): Booked jobs + Today's leads. New layout only; no money on these tiles. */
const Tile = ({ title, icon: I, count, right, children, testId }: { title: string; icon: any; count?: number; right?: React.ReactNode; children: React.ReactNode; testId?: string }) => (
  <section data-testid={testId} className="flex h-full min-w-0 flex-col rounded-xl border border-white/70 bg-white/95 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_4px_14px_rgba(15,23,42,0.06)] backdrop-blur-md dark:border-white/10 dark:bg-[#111a2b]/95 p-3">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <I className="h-4 w-4 text-[#1AA7EC]" />
      <h2 className="text-sm font-semibold">{title}</h2>
      {count != null && <span className="rounded-full bg-[#1AA7EC]/15 px-2 text-xs font-bold text-[#0b5e8a] dark:text-[#7cc8f0]">{count}</span>}
      <div className="ml-auto">{right}</div>
    </div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });

const RANGES: { k: PeriodKind; label: string }[] = [{ k: "today", label: "Today" }, { k: "week", label: "Week" }, { k: "month", label: "Month" }];
/** Full SAST day/week/month window (not just up to now), so later bookings today/this week show. */
function fullRange(k: PeriodKind, now: number) {
  const r = periodRange(k, now);
  const d = new Date(r.start + 2 * 3600_000);
  const end = k === "today" ? r.start + 86400_000 : k === "week" ? r.start + 7 * 86400_000 : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 2 * 3600_000;
  return { start: r.start, end };
}

export function BookedJobsTile() {
  const nav = useNavigate();
  const { companyId } = useUserCompanyId();
  const [k, setK] = useState<PeriodKind>("today");
  const { data, isLoading } = useQuery({
    queryKey: ["v7-booked-jobs", companyId, k],
    enabled: !!companyId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = fullRange(k, Date.now());
      const { data: jobs, error } = await (supabase.from("jobs") as any)
        .select("id, title, status, scheduled_for, customer_id, lead_id, address")
        .eq("company_id", companyId).neq("status", "cancelled")
        .gte("scheduled_for", new Date(r.start).toISOString()).lt("scheduled_for", new Date(r.end).toISOString())
        .order("scheduled_for").limit(100);
      if (error) return [];
      const js = (jobs || []) as any[];
      const ids = js.map((j) => j.id), cust = [...new Set(js.map((j) => j.customer_id).filter(Boolean))], lids = [...new Set(js.map((j) => j.lead_id).filter(Boolean))];
      const [a, c, l] = await Promise.all([
        ids.length ? supabase.from("assignments").select("job_id, profile_id, status").in("job_id", ids) : Promise.resolve({ data: [] } as any),
        cust.length ? supabase.from("customers").select("id, name").in("id", cust) : Promise.resolve({ data: [] } as any),
        lids.length ? supabase.from("leads").select("id, customer_name").in("id", lids) : Promise.resolve({ data: [] } as any),
      ]);
      const asg = ((a as any).data || []).filter((x: any) => !["declined", "cancelled", "rejected"].includes(x.status));
      const pids = [...new Set(asg.map((x: any) => x.profile_id).filter(Boolean))] as string[];
      const { data: profs } = pids.length ? await supabase.from("profiles").select("id, full_name").in("id", pids) : ({ data: [] } as any);
      const pn = new Map(((profs || []) as any[]).map((p) => [p.id, (p.full_name || "").trim()]));
      const cn_ = new Map((((c as any).data || []) as any[]).map((x) => [x.id, x.name]));
      const ln = new Map((((l as any).data || []) as any[]).map((x) => [x.id, x.customer_name]));
      return js.map((j) => ({
        id: j.id, at: j.scheduled_for as string, status: j.status as string,
        client: cn_.get(j.customer_id) || ln.get(j.lead_id) || j.title || "Client",
        tech: asg.filter((x: any) => x.job_id === j.id).map((x: any) => pn.get(x.profile_id)).filter(Boolean).join(", ") || "Unassigned",
      }));
    },
  });
  const rows = data || [];
  return (
    <Tile title="Booked jobs" icon={CalendarClock} count={rows.length} testId="v7-booked-jobs"
      right={<div className="flex gap-0.5" data-testid="v7-booked-toggle">{RANGES.map((x) => (
        <button key={x.k} onClick={() => setK(x.k)} className={cn("rounded-full px-2 py-0.5 text-xs", k === x.k ? "bg-[#1AA7EC] text-white" : "text-muted-foreground hover:bg-muted")}>{x.label}</button>
      ))}</div>}>
      {isLoading ? <div className="h-16 animate-pulse rounded bg-muted/60" /> : rows.length === 0 ? (
        <EmptyNote text={`No booked jobs ${k === "today" ? "today" : k === "week" ? "this week" : "this month"}`} action="Book a job" to="/admin/schedule" />
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => nav(`/admin/jobs/${r.id}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60" data-testid="v7-booked-row">
                <span className="w-14 shrink-0 text-xs font-semibold tabular-nums">{k === "today" ? time(r.at) : <>{day(r.at)}<br /><span className="font-normal text-muted-foreground">{time(r.at)}</span></>}</span>
                <span className="min-w-0 flex-1"><span className="block line-clamp-2 break-words leading-snug text-xs font-medium" title={r.client}>{r.client}</span><span className={cn("block line-clamp-2 break-words text-xs", r.tech === "Unassigned" ? "text-[#DC2626]" : "text-muted-foreground")}>{r.tech}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

export function TodaysLeadsTile() {
  const nav = useNavigate();
  const { companyId } = useUserCompanyId();
  const { data, isLoading } = useQuery({
    queryKey: ["v7-todays-leads", companyId],
    enabled: !!companyId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = periodRange("today", Date.now());
      const { data, error } = await supabase.from("leads").select("id, customer_name, service_type, primary_intent, created_at, first_contact_at, status")
        .eq("company_id", companyId as string).is("deleted_at", null).gte("created_at", new Date(r.start).toISOString()).order("created_at", { ascending: false }).limit(50);
      return error ? [] : ((data || []) as any[]);
    },
  });
  const rows = data || [];
  return (
    <Tile title="Today's leads" icon={Inbox} count={rows.length} testId="v7-todays-leads"
      right={<button onClick={() => nav("/admin/dispatch?inbox=1")} className="text-xs text-[#0b5e8a] hover:underline dark:text-[#7cc8f0]">Inbox</button>}>
      {isLoading ? <div className="h-16 animate-pulse rounded bg-muted/60" /> : rows.length === 0 ? (
        <EmptyNote text="No new leads yet today" action="Add a lead" to="/admin/dispatch?inbox=1" />
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {rows.map((l) => (
            <li key={l.id}>
              <button onClick={() => nav(`/admin/dispatch?lead=${l.id}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60">
                <span className="w-12 shrink-0 text-xs font-semibold tabular-nums">{time(l.created_at)}</span>
                <span className="min-w-0 flex-1"><span className="block line-clamp-2 break-words leading-snug text-xs font-medium" title={l.customer_name || undefined}>{l.customer_name || "New lead"}</span><span className="block line-clamp-2 break-words text-xs text-muted-foreground">{l.service_type || l.primary_intent || "—"}</span></span>
                {!l.first_contact_at && <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-xs font-semibold text-white">Not contacted</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

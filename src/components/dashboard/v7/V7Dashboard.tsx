import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid, ComposedChart, RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import { AlertCircle, Clock, CheckCircle2, PauseCircle, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow, useLeadSla } from "@/hooks/useLeadSla";
import { useLeadInbox, INBOX_ROUTE } from "@/hooks/useLeadInbox";
import { useDashboardV7Data, useIsCompanyOwner } from "@/hooks/useDashboardV7Data";
import {
  METRICS, metric, delta, periodRange, prevRange, shiftMonths, series, lastMonths, aging, outstanding, drafts, paidOfSent, funnel, jobBuckets, rand, ts,
  type PeriodKind, type Range, type MetricKey,
} from "@/lib/dashboardV7";

/* Johan's colour rules: red = overdue, amber = due soon, blue = on time / next step, grey = done / waiting.
   Orange is brand only (buttons). Every colour carries a word + icon. White page, grey panels. */
const C = { red: "#DC2626", amber: "#EAB308", blue: "#1AA7EC", blueDeep: "#1590D6", grey: "#9CA3AF", greyDark: "#6B7280" };
type Tone = "red" | "amber" | "blue" | "grey";
const TONE_ICON = { red: AlertCircle, amber: Clock, blue: CheckCircle2, grey: PauseCircle } as const;
const TONE_CLS: Record<Tone, string> = {
  red: "bg-[#DC2626] text-white", amber: "bg-[#EAB308] text-[#111827]", blue: "bg-[#1AA7EC] text-white", grey: "bg-[#6B7280] text-white",
};
export function TonePill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const I = TONE_ICON[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", TONE_CLS[tone])}><I className="h-3 w-3" />{children}</span>;
}

import { DASHBOARD_LAYOUT } from "@/components/dashboard/v7/dashboardLayout";
import CashflowDashboardPanel from "@/components/cashflow/CashflowDashboardPanel";

const Panel = ({ title, sub, children, className, testId }: { title?: string; sub?: string; children: React.ReactNode; className?: string; testId?: string }) => (
  <section data-testid={testId} className={cn("h-full min-w-0 rounded-xl border border-white/70 bg-white/95 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_4px_14px_rgba(15,23,42,0.06)] backdrop-blur-md dark:border-white/10 dark:bg-[#111a2b]/95 p-3 md:p-4", className)}>
    {title && <div className="mb-2 flex items-baseline gap-2"><h2 className="text-sm font-semibold text-foreground">{title}</h2>{sub && <span className="text-xs text-muted-foreground">{sub}</span>}</div>}
    {children}
  </section>
);

/** Compact empty state (Johan 15:04): short message + one action instead of a dead zero or a tall empty chart. */
export function EmptyNote({ text, action, to }: { text: string; action?: string; to?: string }) {
  const nav = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[#D1D5DB] bg-white/60 px-3 py-2 text-xs text-muted-foreground dark:border-white/15 dark:bg-white/5" data-testid="v7-empty">
      <span className="min-w-0">{text}</span>
      {action && to && <button onClick={() => nav(to)} className="ml-auto shrink-0 rounded-full bg-[#1AA7EC] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#1590D6]">{action}</button>}
    </div>
  );
}

const PERIODS: { k: PeriodKind; label: string }[] = [
  { k: "today", label: "Today" }, { k: "week", label: "Week" }, { k: "month", label: "Month" }, { k: "quarter", label: "Quarter" }, { k: "year", label: "Year" }, { k: "custom", label: "Custom" },
];
const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
const fmt = (m: (typeof METRICS)[number], v: number | null) => (v == null ? "—" : m.money ? rand(v) : m.pct ? `${v}%` : String(v));

const DELTA_TEXT: Record<string, { short: string; long: string }> = {
  prev: { short: "vs prev period", long: "the period of the same length straight before" },
  LM: { short: "vs last month", long: "the same period last month" },
  LY: { short: "vs last year", long: "the same period last year" },
};

/** Visual delta (Johan 13 Oct 13:00): green ▲ up, red ▼ down, grey dot flat / no data. */
function Delta({ label, v }: { label: string; v: number | null }) {
  const t = DELTA_TEXT[label] || { short: `vs ${label}`, long: label };
  const up = v != null && v > 0, down = v != null && v < 0;
  const title = v == null ? `No data to compare with ${t.long}` : v === 0 ? `Same as ${t.long}` : `${up ? "Up" : "Down"} ${Math.abs(v)}% compared with ${t.long}`;
  return (
    <span data-testid="v7-delta" className="inline-flex items-center gap-1 whitespace-nowrap text-xs" title={title}>
      {up ? <span className="font-semibold text-[#16A34A]">▲ +{v}%</span>
        : down ? <span className="font-semibold text-[#DC2626]">▼ {v}%</span>
        : <span className="inline-flex items-center gap-1 text-[#9CA3AF]"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#9CA3AF]" />{v === 0 ? "0%" : "–"}</span>}
      <span className="text-muted-foreground">{t.short}</span>
    </span>
  );
}

function Spark({ data, ghost }: { data: number[]; ghost?: number[] }) {
  const d = data.map((v, i) => ({ i, v, g: ghost?.[i] }));
  return (
    <div className="h-7 w-20">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={d}>{ghost && <Line type="monotone" dataKey="g" stroke={C.greyDark} strokeOpacity={0.35} strokeWidth={1.2} dot={false} isAnimationActive={false} />}<Line type="monotone" dataKey="v" stroke={C.blue} strokeWidth={1.6} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
    </div>
  );
}

function Gauge({ title, pct, caption }: { title: string; pct: number; caption: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <Panel className="flex flex-col items-center" testId="v7-gauge">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="relative h-28 w-48">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="85%" innerRadius="115%" outerRadius="150%" startAngle={180} endAngle={0} data={[{ v }]} barSize={14}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="v" cornerRadius={7} fill={C.blue} background={{ fill: "rgba(156,163,175,0.35)" }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-x-0 bottom-1 text-center text-3xl font-bold">{v}%</div>
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </Panel>
  );
}

const leadKind = (l: any) => {
  const s = `${l.primary_intent || ""} ${l.service_type || ""}`.toLowerCase();
  return /quote|sale|install|new/.test(s) ? "sales" : "tech";
};

export default function V7Dashboard({ audience, slots }: { audience: "office" | "sales"; slots?: Record<string, React.ReactNode> }) {
  const navigate = useNavigate();
  const now = useNow();
  const { sla } = useLeadSla();
  const { data: isOwner } = useIsCompanyOwner();
  const office = audience === "office";
  const owner = office && !!isOwner;
  const { data, isLoading } = useDashboardV7Data({ office, owner });
  const { leads: inbox } = useLeadInbox();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [revCmp, setRevCmp] = useState<"prev" | "lm" | "ly">("ly");
  const [cmp, setCmp] = useState<"prev" | "ly">("prev");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const nowMin = Math.floor(now / 60_000) * 60_000;

  const customRange: Range | undefined = custom.from && custom.to ? { start: ts(custom.from), end: ts(custom.to) + 86400_000 } : undefined;
  const sel = periodRange(kind, nowMin, customRange);
  const base = cmp === "prev" ? prevRange(sel) : shiftMonths(sel, -12);
  const metrics = METRICS.filter((m) => (!m.office || office) && (!m.owner || owner));
  const cols: { key: string; label: string; r: Range; selected: boolean }[] = useMemo(() => {
    const c = [
      { key: "today", label: "Today", r: periodRange("today", nowMin), selected: kind === "today" },
      { key: "week", label: "This week", r: periodRange("week", nowMin), selected: kind === "week" },
      { key: "month", label: "This month (MTD)", r: periodRange("month", nowMin), selected: kind === "month" },
    ];
    if (!["today", "week", "month"].includes(kind)) c.push({ key: kind, label: PERIODS.find((p) => p.k === kind)!.label, r: sel, selected: true });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, nowMin, sel.start, sel.end]);

  if (isLoading || !data) {
    // Row 1 (slots) never waits for the overview data.
    return <V7Rows office={office} B={{ ...(slots || {}), period_bar: <Panel testId="v7-loading"><div className="h-40 animate-pulse rounded-lg bg-white/60 dark:bg-white/5" /></Panel> }} />;
  }

  const val = (k: MetricKey, r: Range) => metric(data, k, r);
  const months = lastMonths(nowMin);
  const revenue = series(data, "paid", nowMin);
  const revenueLy = months.map((m) => metric(data, "paid", shiftMonths(m, -12)) ?? 0);
  const ghostShift = revCmp === "ly" ? -12 : -1; // monthly bars: prev period = month before = last month
  const ghostLabel = revCmp === "ly" ? "Last year" : revCmp === "lm" ? "Last month" : "Previous period";
  const revData = months.map((m, i) => ({ month: m.label, current: Math.round(revenue[i] / 1000), ghost: Math.round((revCmp === "ly" ? revenueLy[i] : (metric(data, "paid", shiftMonths(m, ghostShift)) ?? 0)) / 1000) }));
  const ytd = periodRange("year", nowMin);
  const sent = val("quotes_sent", sel) ?? 0, accepted = val("quotes_accepted", sel) ?? 0;
  const invoicedSel = val("invoiced", sel) ?? 0, paidSel = val("paid", sel) ?? 0;
  const out = outstanding(data.invoices);
  const dr = drafts(data.invoices);
  const pos = paidOfSent(data.invoices, sel);
  const ag = aging(data.invoices, nowMin);
  const agMax = Math.max(1, ...ag.map((a) => a.amount));
  const fun = funnel(data, sel);
  const funMax = Math.max(1, fun[0].value);
  const jb = jobBuckets(data.jobs, nowMin);
  const jbRows: { k: keyof typeof jb; label: string; tone: Tone; color: string }[] = [
    { k: "overdue", label: "Overdue", tone: "red", color: C.red },
    { k: "scheduled", label: "Scheduled", tone: "blue", color: C.blue },
    { k: "in_progress", label: "In progress", tone: "blue", color: C.blueDeep },
    { k: "waiting", label: "Waiting for stock", tone: "amber", color: C.amber },
    { k: "completed", label: "Completed", tone: "grey", color: C.grey },
  ];
  const openJobs = jb.overdue + jb.scheduled + jb.in_progress + jb.waiting;
  const sortedInbox = [...(inbox as any[])].sort((a, b) => ts(a.created_at) - ts(b.created_at)).slice(0, 5);
  const slaMs = (sla?.contactMinutes ?? 5) * 60_000;

  // Team workload: open assignments per person; earnings only for the company owner (own team).
  const load: Record<string, number> = {};
  for (const a of data.assignments) if (a.profile_id && a.jobs?.status !== "completed") load[a.profile_id] = (load[a.profile_id] || 0) + 1;
  const earn: Record<string, number> = {};
  const mtd = periodRange("month", nowMin);
  if (owner) {
    for (const e of data.earnings || []) if (e.tech_id && (!e.completed_at || ts(e.completed_at) >= mtd.start)) earn[e.tech_id] = (earn[e.tech_id] || 0) + (Number(e.net_amount) || 0);
    for (const c of data.commissions || []) if (c.rep_id && ts(c.earned_at || c.created_at) >= mtd.start) earn[c.rep_id] = (earn[c.rep_id] || 0) + (Number(c.commission) || 0);
  }
  const team = (data.team as any[]).map((p) => ({ ...p, open: load[p.id] || 0, earn: earn[p.id] || 0 })).filter((p) => p.open > 0 || p.earn > 0).sort((a, b) => b.open - a.open).slice(0, 8);
  const teamMax = Math.max(1, ...team.map((t) => t.open));

  // Every dashboard block by id; DASHBOARD_LAYOUT (dashboardLayout.ts) decides the rows and order.
  const B: Record<string, React.ReactNode> = {
    period_bar: (<><div className="flex flex-wrap items-center gap-2" data-testid="v7-period-bar">
        <span className="hidden md:inline text-xs text-muted-foreground">Period</span>
        <div className="flex flex-wrap gap-1 overflow-x-auto">
          {PERIODS.map((p) => (
            <button key={p.k} onClick={() => setKind(p.k)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", kind === p.k ? "border-[#1AA7EC] bg-[#1AA7EC] text-white" : "border-[#E5E7EB] bg-white text-foreground hover:bg-[#F3F4F6] dark:border-white/10 dark:bg-transparent")}>{p.label}</button>
          ))}
        </div>
        {kind === "custom" && (
          <span className="flex items-center gap-1 text-xs">
            <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="rounded border bg-background px-1 py-0.5" aria-label="From" />
            –<input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="rounded border bg-background px-1 py-0.5" aria-label="To" />
          </span>
        )}
        <span className="text-xs text-muted-foreground">{fmtDate(sel.start)} – {fmtDate(sel.end - 1)}</span>

      </div></>),
    compare_to: (<><span className="flex items-center gap-1 text-xs">
          <span className="hidden sm:inline text-muted-foreground">Compare to</span>
          {(["prev", "ly"] as const).map((c) => (
            <button key={c} onClick={() => setCmp(c)} className={cn("rounded-full border px-3 py-1 font-medium", cmp === c ? "border-[#1590D6] bg-[#1590D6] text-white" : "border-[#E5E7EB] bg-white dark:border-white/10 dark:bg-transparent")}>{c === "prev" ? "Previous period" : "Last year"}</button>
          ))}
        </span></>),
    compare_table: (<><Panel title="Compare periods" sub="▲ up · ▼ down · ● no change / no data · hover a figure for details · faint line = last year" testId="v7-compare">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Metric</th><th className="py-1 pr-2 font-medium">12 mo</th>
              {cols.map((c) => <th key={c.key} className={cn("py-1 pr-2 font-medium", c.selected && "text-[#1590D6]")}>{c.label}{c.selected && " · selected"}</th>)}
            </tr></thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.key} className="border-t border-[#E5E7EB] dark:border-white/10">
                  <td className="py-1.5 pr-2 text-xs font-medium">{m.label}</td>
                  <td className="py-1.5 pr-2"><Spark data={series(data, m.key, nowMin)} ghost={lastMonths(nowMin).map((mm) => metric(data, m.key, shiftMonths(mm, -12)) ?? 0)} /></td>
                  {cols.map((c) => {
                    const v = val(m.key, c.r);
                    return (
                      <td key={c.key} className={cn("py-1.5 pr-2 align-top", c.selected && "bg-white/70 dark:bg-white/5")}>
                        <div className="text-base font-bold leading-tight">{fmt(m, v)}</div>
                        <div className="flex flex-wrap gap-x-1.5">
                          <Delta label="prev" v={delta(v, val(m.key, prevRange(c.r)))} />
                          <Delta label="LM" v={delta(v, val(m.key, shiftMonths(c.r, -1)))} />
                          <Delta label="LY" v={delta(v, val(m.key, shiftMonths(c.r, -12)))} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel></>),
    revenue_ytd: (office && <Panel className="col-span-2 md:col-span-1"><div className="text-xs text-muted-foreground">Revenue YTD (paid)</div><div className="text-xl font-bold kpi-fluid tabular-nums [--kpi-max:1.5rem]">{rand(val("paid", ytd) ?? 0)}</div><Spark data={revenue} ghost={revenueLy} /></Panel>),
    paid_period: (office && <Panel><div className="text-xs text-muted-foreground">Paid · {PERIODS.find((p) => p.k === kind)!.label}</div><div className="text-xl font-bold kpi-fluid tabular-nums [--kpi-max:1.5rem]">{rand(paidSel)}</div><Delta label={cmp === "prev" ? "prev" : "LY"} v={delta(paidSel, val("paid", base))} /></Panel>),
    outstanding: (office && <Panel><div className="text-xs text-muted-foreground">Outstanding (sent, unpaid)</div><div className="text-xl font-bold kpi-fluid tabular-nums [--kpi-max:1.5rem]">{rand(out)}</div></Panel>),
    draft_invoices: (office && <Panel testId="v7-draft-invoices"><div className="text-xs text-muted-foreground">Draft invoices (not sent)</div><div className="text-xl font-bold kpi-fluid tabular-nums [--kpi-max:1.5rem]">{rand(dr.amount)}</div><div className="text-xs text-muted-foreground">{dr.count} draft{dr.count === 1 ? "" : "s"} · not in outstanding</div></Panel>),
    open_jobs: (<><Panel><div className="text-xs text-muted-foreground">Open jobs</div>{openJobs === 0 ? <div className="mt-1"><EmptyNote text="No open jobs" action="Book a job" to="/admin/schedule" /></div> : <div className="text-xl font-bold">{openJobs}</div>}{jb.overdue > 0 && <TonePill tone="red">{jb.overdue} overdue</TonePill>}</Panel></>),
    new_leads: (<><Panel><div className="text-xs text-muted-foreground">New leads · {PERIODS.find((p) => p.k === kind)!.label}</div><div className="text-xl font-bold">{val("new_leads", sel)}</div><Delta label={cmp === "prev" ? "prev" : "LY"} v={delta(val("new_leads", sel), val("new_leads", base))} /></Panel></>),
    quotes_sent: (!office && <Panel><div className="text-xs text-muted-foreground">Quotes sent</div><div className="text-xl font-bold">{sent}</div></Panel>),
    quotes_accepted: (!office && <Panel><div className="text-xs text-muted-foreground">Quotes accepted</div><div className="text-xl font-bold">{accepted}</div></Panel>),
    quote_conversion: (<><Gauge title="Quote conversion" pct={sent ? (accepted / sent) * 100 : 0} caption={`${accepted} of ${sent} accepted`} /></>),
    invoices_paid: (office && <Gauge title="Invoices paid" pct={pos.sent ? (pos.paid / pos.sent) * 100 : 0} caption={pos.count ? `${rand(pos.paid)} of ${rand(pos.sent)} sent invoices (${pos.count}) · drafts excluded` : "No sent invoices this period · drafts excluded"} />),
    outstanding_share: (office && <Gauge title="Outstanding share" pct={invoicedSel + out ? (out / Math.max(1, (val("invoiced", ytd) ?? 0))) * 100 : 0} caption={`${rand(out)} unpaid of ${rand(val("invoiced", ytd) ?? 0)} sent this year · drafts excluded`} />),
    monthly_revenue: (office && (
          <Panel title="Monthly revenue (R thousands)" sub={`paid, last 12 months · faint bars = ${ghostLabel.toLowerCase()}`} className="lg:col-span-2" testId="v7-revenue">
            <div className="mb-1 flex justify-end gap-1 text-xs" data-testid="v7-rev-toggle">
              {([["prev", "Prev"], ["lm", "Last month"], ["ly", "Last year"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setRevCmp(k)} className={cn("rounded-full border px-2 py-0.5", revCmp === k ? "border-[#1590D6] bg-[#1590D6] text-white" : "border-[#E5E7EB] bg-white dark:border-white/10 dark:bg-transparent")}>{l}</button>
              ))}
            </div>
            {revData.every((r) => !r.current && !r.ghost) ? <EmptyNote text="No paid invoices in the last 12 months yet" action="Invoices" to="/admin/invoices" /> : <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={-16}>
                  <CartesianGrid vertical={false} stroke="rgba(156,163,175,0.3)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: any, n: any) => [`R ${v}k`, n === "current" ? "This period" : ghostLabel]} />
                  <Bar dataKey="ghost" barSize={16} fill={C.greyDark} fillOpacity={0.22} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="current" barSize={10} fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>}
          </Panel>
        )),
    lead_funnel: (<><Panel title="Lead funnel" sub={PERIODS.find((p) => p.k === kind)!.label} testId="v7-funnel">
          {fun.every((x) => !x.value) ? <EmptyNote text="No leads in this period yet" action="New lead" to="/admin/dispatch?inbox=1" /> : <div className="space-y-1.5">
            {fun.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="h-7 rounded-md px-2 text-xs font-medium leading-7 text-white" style={{ width: `${Math.max(18, (s.value / funMax) * 100)}%`, background: i === fun.length - 1 ? C.blueDeep : C.blue, opacity: 1 - i * 0.12 }}>{s.label}</div>
                <span className="text-sm font-bold">{s.value}</span>
              </div>
            ))}
          </div>}
        </Panel></>),
    leads_inbox: (<><Panel title="New Leads inbox" sub="oldest first · type · route" testId="v7-inbox">
        {sortedInbox.length === 0 ? <EmptyNote text="No leads waiting. All done" action="New lead" to="/admin/dispatch?inbox=1" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Lead</th><th className="font-medium">Type</th><th className="font-medium">Waiting</th><th className="font-medium">Route to</th></tr></thead>
              <tbody>
                {sortedInbox.map((l: any) => {
                  const w = nowMin - ts(l.created_at); const tone: Tone = w >= slaMs ? "red" : w >= slaMs * 0.4 ? "amber" : "blue";
                  const mins = Math.floor(w / 60000); const wait = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`;
                  const k = leadKind(l);
                  return (
                    <tr key={l.id} className="cursor-pointer border-t border-[#E5E7EB] hover:bg-white/60 dark:border-white/10 dark:hover:bg-white/5" onClick={() => navigate(INBOX_ROUTE)}>
                      <td className="py-1.5 pr-2 text-xs">{l.customer_name || "Unnamed"}{l.call_area ? ` · ${l.call_area}` : ""}</td>
                      <td className="pr-2 text-xs text-muted-foreground">{k === "sales" ? "Sales quote" : "Service call-out"}</td>
                      <td className="pr-2"><TonePill tone={tone}>{tone === "red" ? "Overdue" : tone === "amber" ? "Due soon" : "On time"} · {wait}</TonePill></td>
                      <td className="text-xs font-semibold">{k === "sales" ? "Sales" : "Tech"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel></>),
    job_status: (<><Panel title="Jobs by status" testId="v7-jobs">
          {openJobs + jb.completed === 0 ? <EmptyNote text="No jobs yet" action="Book a job" to="/admin/schedule" /> : <div className="flex items-center gap-3">
            <div className="relative h-32 w-32 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={jbRows.map((r) => ({ name: r.label, value: jb[r.k] }))} dataKey="value" innerRadius="62%" outerRadius="95%" stroke="none" isAnimationActive={false}>{jbRows.map((r) => <Cell key={r.k} fill={r.color} />)}</Pie></PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold">{openJobs + jb.completed}</span><span className="text-xs text-muted-foreground">jobs</span></div>
            </div>
            <ul className="flex-1 space-y-1 text-xs">
              {jbRows.map((r) => { const I = TONE_ICON[r.tone]; return <li key={r.k} className="flex items-center gap-1.5"><I className="h-3.5 w-3.5" style={{ color: r.color }} />{r.label}<span className="ml-auto font-bold">{jb[r.k]}</span></li>; })}
            </ul>
          </div>}
        </Panel></>),
    aging: (office && (
          <Panel title="Accounts aging" sub="unpaid, by days past due" testId="v7-aging">
            <div className="space-y-2">
              {ag.map((a, i) => { const tone: Tone = i === 0 ? "blue" : i === 1 ? "amber" : "red"; const I = TONE_ICON[tone];
                return (
                  <div key={a.label}>
                    <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1"><I className="h-3 w-3" style={{ color: C[tone] }} />{a.label} · {i === 0 ? "current" : i === 1 ? "due soon" : "overdue"}</span><span className="font-semibold">{rand(a.amount)}</span></div>
                    <div className="h-2 rounded bg-[#E5E7EB] dark:bg-white/10"><div className="h-2 rounded" style={{ width: `${(a.amount / agMax) * 100}%`, background: C[tone] }} /></div>
                  </div>
                ); })}
            </div>
          </Panel>
        )),
    cash_flow: (office && <CashflowDashboardPanel Panel={Panel} />),
    team: (office && (
        <Panel title="Team workload & earnings" sub={owner ? "open jobs · earnings this month" : "open jobs"} testId="v7-team">
          {team.length === 0 ? <EmptyNote text="No open assignments" action="Dispatch" to="/admin/dispatch" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Person</th><th className="font-medium">Workload (open jobs)</th>{owner && <th className="text-right font-medium">Earnings (MTD)</th>}</tr></thead>
              <tbody>
                {team.map((p) => (
                  <tr key={p.id} className="border-t border-[#E5E7EB] dark:border-white/10">
                    <td className="py-1.5 pr-2"><div className="text-xs font-medium">{p.full_name || "—"}</div><div className="text-xs text-muted-foreground">{p.dispatch_role === "sales" ? "Sales" : p.job_title || "Technician"}</div></td>
                    <td className="pr-2"><div className="h-2 w-full max-w-[220px] rounded bg-[#E5E7EB] dark:bg-white/10"><div className="h-2 rounded bg-[#1AA7EC]" style={{ width: `${(p.open / teamMax) * 100}%` }} /></div><span className="text-xs text-muted-foreground">{p.open} jobs</span></td>
                    {owner && <td className="text-right font-semibold">{rand(p.earn)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )),
    ...(slots || {}),
  };
  return <V7Rows office={office} B={B} />;
}

function V7Rows({ office, B }: { office: boolean; B: Record<string, React.ReactNode> }) {
  return (
    <div className="space-y-4 md:space-y-5" data-testid="v7-dashboard">
      {DASHBOARD_LAYOUT.filter((row) => !row.office || office).map((row) => {
        const items = row.items.filter((id) => B[id] != null && B[id] !== false);
        if (!items.length) return null;
        return (
          <section key={row.id} data-testid={`v7-row-${row.id}`} className="space-y-2">
            {row.title && <div className="flex items-center gap-2"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.title}</h2><div className="h-px flex-1 bg-border" /></div>}
            <div className={row.grid}>
              {items.map((id) => <div key={id} data-block={id} className={cn("flex min-w-0 flex-col [&>*]:min-w-0 [&>*]:flex-1", row.span?.[id])}>{B[id]}</div>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

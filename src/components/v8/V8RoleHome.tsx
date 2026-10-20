import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { useLeadInbox } from "@/hooks/useLeadInbox";
import { Button } from "@/components/ui/button";
import { buildDeals, fmtRandShort } from "@/lib/quotePipeline";
import { V8_COLS, v8ColOf, type V8Col } from "@/lib/v8Flow";
import { usePipelineData, nameOf } from "@/components/jobs/PipelineBoard";
import type { V8Role } from "./v8Nav";
import V8NumberRow from "./V8NumberRow";
import SalesHeartbeat from "@/components/heartbeat/SalesHeartbeat";
import "./v8.css";

type Item = { id: string; title: string; sub: string; btn: string; to: string; tag: string };

/** v8 Simple home (New layout only): hero · Next up · flow strip · New leads · Needs you today.
 *  Read-only over the existing pipeline + lead inbox queries; RLS scopes rows (company admins see only their company, sales only theirs). */
export default function V8RoleHome({ role }: { role: V8Role }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const identity = useSignedInIdentity();
  const { data } = usePipelineData();
  const { leads: inbox, count: inboxCount } = useLeadInbox();
  const own = role === "sales";
  const s = useMemo(() => {
    const out = { count: {} as Record<V8Col, number>, value: {} as Record<V8Col, number>, month: 0, needs: [] as Item[], next: null as Item | null };
    if (!data) return out;
    const qs = own ? data.quotes.filter((q) => q.sales_engineer_id === user?.id) : data.quotes;
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const accepted: Item[] = [], viewed: Item[] = [], unpaid: Item[] = [];
    buildDeals(qs, data.invoices as any, data.jobs as any).forEach((d) => {
      const c = v8ColOf(d, data.invoices as any);
      out.count[c] = (out.count[c] || 0) + 1; out.value[c] = (out.value[c] || 0) + d.value;
      if (d.quote.accepted_at && new Date(d.quote.accepted_at) >= m0) out.month += d.value;
      const n = nameOf(d.quote as any), num = d.quote.quote_number || "Quote";
      const to = `/admin/estimates/${d.quote.id}`;
      if (c === "accepted") accepted.push({ id: d.quote.id, title: `${d.depositDue ? "Deposit due" : "Book the job"} · ${n}`, sub: `${num} accepted · ${fmtRandShort(d.value)}`, btn: "Book", to, tag: "J" });
      if (d.stage === "viewed") viewed.push({ id: d.quote.id, title: `${num} · ${n}`, sub: "Viewed · not accepted yet", btn: "Nudge", to, tag: "Q" });
      if (c === "invoiced") unpaid.push({ id: d.quote.id, title: `${num} · ${n}`, sub: `Invoiced · ${fmtRandShort(d.value - d.paid)} outstanding`, btn: "Remind", to, tag: "I" });
    });
    const quoted = new Set(data.quotes.map((q) => q.lead_id).filter(Boolean));
    out.count.lead = own ? 0 : data.leads.filter((l) => !quoted.has(l.id)).length;
    out.next = accepted[0] || viewed[0] || null;
    out.needs = [...accepted.slice(1, 3), ...viewed.slice(0, 2), ...unpaid.slice(0, 2)].slice(0, 5);
    return out;
  }, [data, own, user?.id]);
  const first = (identity?.name || "").split(/\s+/)[0];
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const outstanding = s.value.invoiced || 0;
  const today = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short" });
  const ago = (t?: string) => { if (!t) return ""; const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

  return (
    <div className="space-y-3" data-testid={`v8-home-${role}`}>
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-[#1590d6]">{today} · month to date{role === "owner" && settings?.company_name ? ` · ${settings.company_name}` : ""}</div>
        <h1 className="text-2xl font-extrabold">{greet}{first ? `, ${first}` : ""}</h1>
        <div className="text-sm text-muted-foreground">One flow: lead → quote → job → invoice → paid. Here's where it stands.</div>
      </div>
      {role !== "tech" && <SalesHeartbeat />}
      {(role === "owner" || role === "admin") && <V8NumberRow />}
      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="v8-hero">
          <div className="text-sm opacity-90">{own ? "My accepted work this month" : "Accepted this month"}</div>
          <div className="text-4xl font-extrabold tabular-nums">{fmtRandShort(s.month)}</div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 text-sm">
            <span className="opacity-85">Open pipeline {fmtRandShort((s.value.quote || 0) + (s.value.accepted || 0))}</span>
            <span className="text-right"><span className="block text-xs opacity-80">Outstanding</span><span className="text-xl font-bold tabular-nums">{fmtRandShort(outstanding)}</span></span>
          </div>
          {own && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate("/admin/my-commission")}>My commission</Button>}
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-sm font-bold">Next up</div>
          {s.next ? (<>
            <div className="mt-2 text-lg font-extrabold">{s.next.title}</div>
            <div className="text-sm text-muted-foreground">{s.next.sub}</div>
            <Button variant="outline" className="mt-3 w-full" onClick={() => navigate(s.next!.to)}>{s.next.btn === "Book" ? "Open and book" : "Open quote"}</Button>
          </>) : <div className="mt-2 text-sm text-muted-foreground">Nothing waiting. Nice.</div>}
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-bold">The flow this month</span>
          <button className="text-xs font-semibold text-[#1590d6]" onClick={() => navigate("/admin/jobs?tab=pipeline")}>Open pipeline →</button></div>
        <div className="v8-flow">
          {V8_COLS.filter((c) => !(own && c.key === "lead")).map((c) => (
            <button key={c.key} onClick={() => navigate(c.key === "lead" ? "/admin/dispatch" : "/admin/jobs?tab=pipeline")}>
              <div className="text-xs opacity-70">{c.label}</div>
              <div className="text-lg font-bold tabular-nums">{s.count[c.key] || 0}</div>
              <div className="text-xs opacity-60 tabular-nums">{c.key === "lead" ? "R —" : fmtRandShort(s.value[c.key] || 0)}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {!own && (
          <div className="rounded-2xl border bg-card p-3">
            <div className="mb-1 flex items-center justify-between"><span className="text-sm font-bold">New leads · reply within 5 min</span>
              <button className="text-xs font-semibold text-[#1590d6]" onClick={() => navigate("/admin/dispatch")}>Inbox ({inboxCount}) →</button></div>
            {(inbox as any[]).slice(0, 3).map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-t py-2 text-sm first:border-t-0">
                <span className="min-w-0 flex-1 truncate font-semibold">{l.customer_name || "New lead"}<span className="ml-2 font-normal text-muted-foreground">{l.source || ""}</span></span>
                <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{ago(l.created_at)}</span>
              </div>))}
            {inboxCount === 0 && <div className="py-2 text-sm text-muted-foreground">No new leads waiting.</div>}
          </div>
        )}
        <div data-testid="v8-needs" className="rounded-2xl border bg-card p-3">
          <div className="mb-1 flex items-center justify-between"><span className="text-sm font-bold">Needs you today</span><span className="text-xs font-semibold text-[#1590d6]">{s.needs.length} items</span></div>
          {s.needs.map((n) => (
            <div key={n.id + n.btn} className="flex items-center gap-2 border-t py-2 text-sm first:border-t-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1590d6]/10 text-xs font-bold text-[#1590d6]">{n.tag}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{n.title}</span><span className="block truncate text-xs text-muted-foreground">{n.sub}</span></span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(n.to)}>{n.btn}</Button>
            </div>))}
          {s.needs.length === 0 && <div className="py-2 text-sm text-muted-foreground">All clear.</div>}
        </div>
      </div>
    </div>
  );
}

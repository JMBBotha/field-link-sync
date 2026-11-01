import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { useLeadInbox } from "@/hooks/useLeadInbox";
import { useLinkedAdmin } from "@/hooks/useLinkedAdmin";
import { homeScope, quoteInScope } from "@/lib/homeScope";
import { Button } from "@/components/ui/button";
import { buildDeals, fmtRandShort } from "@/lib/quotePipeline";
import { V8_COLS, v8ColOf, type V8Col } from "@/lib/v8Flow";
import { usePipelineData, nameOf } from "@/components/jobs/PipelineBoard";
import type { V8Role } from "./v8Nav";
import V8NumberRow from "./V8NumberRow";
import SalesHeartbeat from "@/components/heartbeat/SalesHeartbeat";
import { useHeartbeatAudience } from "@/hooks/useSalesHeartbeat";
import InvoiceApprovalPanel from "@/components/invoicing/InvoiceApprovalPanel";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invoiceMoney } from "@/lib/moneySummary";
import { isUnpaid } from "@/lib/unpaidBuckets";
import { fetchCreditNotes } from "@/lib/creditNotes";
import "./v8.css";

/** p112: Outstanding = balance owing after payments and credits on every unpaid invoice (same rule as Invoices > Unpaid).
 *  ownQuoteIds = plain rep: only invoices on their own quotes; null = company-wide. */
function useHomeOutstanding(ownQuoteIds: string[] | null) {
  return useQuery({
    queryKey: ["v8-home-outstanding", ownQuoteIds ? ownQuoteIds.join(",") : "all"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: inv } = await (supabase.from("invoices") as any).select("id, quote_id, status, grand_total, notes, archived_at").not("status", "in", "(paid,void,cancelled,draft)").limit(2000);
      const rows = ((inv || []) as any[]).filter((i) => !i.archived_at && (!ownQuoteIds || (i.quote_id && ownQuoteIds.includes(i.quote_id))));
      if (!rows.length) return { total: 0, count: 0, byQuote: {} as Record<string, number> };
      const ids = rows.map((r) => r.id);
      const { data: pays } = await supabase.from("payments").select("invoice_id, amount, status, gateway").in("invoice_id", ids);
      const credits = await fetchCreditNotes(ids);
      let total = 0, count = 0; const byQuote: Record<string, number> = {};
      rows.forEach((r) => { const b = invoiceMoney(r, (pays || []) as any, credits as any).balance; if (isUnpaid(r.status, b)) { total += b; count += 1; if (r.quote_id) byQuote[r.quote_id] = (byQuote[r.quote_id] || 0) + b; } });
      return { total: Math.round(total * 100) / 100, count, byQuote };
    },
  });
}

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
  const linked = useLinkedAdmin();
  // p117 (Johan "Merge into one"): the heartbeat "Next step" card (one button + Then, tap = pop-up) is the only next-step card when it shows.
  const hbAud = useHeartbeatAudience();
  const hbShows = role !== "tech" && hbAud.canSee;
  // Sales login linked to an admin account counts company-wide; a plain rep counts their own quotes.
  const own = homeScope(role, linked.data) === "own";
  const s = useMemo(() => {
    const out = { count: {} as Record<V8Col, number>, value: {} as Record<V8Col, number>, month: 0, prevMonth: 0, drafts: 0, invoicedIds: [] as string[], needs: [] as Item[], next: null as Item | null };
    if (!data) return out;
    const qs = data.quotes.filter((q) => quoteInScope(q, own ? "own" : "company", user?.id));
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const p0 = new Date(m0); p0.setMonth(p0.getMonth() - 1);
    const accepted: Item[] = [], viewed: Item[] = [], unpaid: Item[] = [];
    buildDeals(qs, data.invoices as any, data.jobs as any).forEach((d) => {
      const c = v8ColOf(d, data.invoices as any);
      // p115 (Johan): "Quotes open" counts only sent/viewed quotes; drafts are shown apart as "Drafts not sent: N".
      if (d.stage === "draft") { out.drafts += 1; return; }
      out.count[c] = (out.count[c] || 0) + 1; out.value[c] = (out.value[c] || 0) + d.value;
      if (c === "invoiced") out.invoicedIds.push(d.quote.id);
      const acc = d.quote.accepted_at ? new Date(d.quote.accepted_at) : null;
      if (acc && acc >= m0) out.month += d.value; else if (acc && acc >= p0) out.prevMonth += d.value;
      const n = nameOf(d.quote as any), num = d.quote.quote_number || "Quote";
      const to = `/admin/estimates/${d.quote.id}`;
      if (c === "accepted") accepted.push({ id: d.quote.id, title: `${d.depositDue ? "Deposit due" : "Book the job"} · ${n}`, sub: `${num} accepted · ${fmtRandShort(d.value)}`, btn: d.depositDue ? "Open deposit" : "Book", to, tag: "J" });
      if (d.stage === "viewed") viewed.push({ id: d.quote.id, title: `${num} · ${n}`, sub: "Viewed · not accepted yet", btn: "Follow up", to, tag: "Q" });
      if (c === "invoiced") unpaid.push({ id: d.quote.id, title: `${num} · ${n}`, sub: "Invoiced · waiting for payment", btn: "Remind", to, tag: "I" });
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
  const ownIds = useMemo(() => (own && data ? data.quotes.filter((q) => q.sales_engineer_id === user?.id).map((q) => q.id) : null), [own, data, user?.id]);
  const out = useHomeOutstanding(ownIds);
  const outstanding = out.data?.total ?? 0;
  const monthName = new Date().toLocaleDateString("en-ZA", { month: "long" });
  const prevName = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString("en-ZA", { month: "long" }); })();
  const openTotal = s.value.quote || 0; // sent or viewed only, option groups once
  // p115 (Johan): the Invoiced tile shows the balance still owed on those invoices, not the quote value.
  const invoicedOwed = s.invoicedIds.reduce((t, id) => t + (out.data?.byQuote?.[id] || 0), 0);
  const today = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short" });
  const ago = (t?: string) => { if (!t) return ""; const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

  return (
    <div className="space-y-3" data-testid={`v8-home-${role}`}>
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-[#1590d6]">{today} · month to date{role === "owner" && settings?.company_name ? ` · ${settings.company_name}` : ""}</div>
        <h1 className="text-2xl font-extrabold">{greet}{first ? `, ${first}` : ""}</h1>
        <div className="text-sm text-muted-foreground">One flow: lead → quote → job → invoice → paid. Here's where it stands.</div>
      </div>
      {role !== "tech" && <InvoiceApprovalPanel />}
      {role !== "tech" && <SalesHeartbeat />}
      {(role === "owner" || role === "admin") && <V8NumberRow />}
      <div className={hbShows ? "grid gap-3" : "grid gap-3 lg:grid-cols-[1.5fr_1fr]"}>
        <div className="v8-hero">
          <div className="text-sm opacity-90">{own ? "My quotes accepted" : "Quotes accepted"} in {monthName} · incl. VAT</div>
          <div className="text-4xl font-extrabold tabular-nums" data-testid="hero-accepted">{fmtRandShort(s.month)}</div>
          <div className="text-xs opacity-80">By accepted date · {prevName}: {fmtRandShort(s.prevMonth)}</div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 text-sm">
            <span className="opacity-85" data-testid="hero-open">Open quotes {fmtRandShort(openTotal)} incl. VAT<span className="block text-xs opacity-80">Sent, not accepted yet · option groups count once{s.drafts > 0 ? ` · Drafts not sent: ${s.drafts}` : ""}</span></span>
            <button type="button" className="text-right" onClick={() => navigate("/admin/invoices?state=unpaid")} data-testid="hero-outstanding"><span className="block text-xs opacity-80">Owed on unpaid invoices · incl. VAT</span><span className="text-xl font-bold tabular-nums">{fmtRandShort(outstanding)}</span><span className="block text-xs opacity-80">{out.data?.count ?? 0} invoice{out.data?.count === 1 ? "" : "s"} · all dates →</span></button>
          </div>
          {own && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate("/admin/my-commission")}>My commission</Button>}
        </div>
        {!hbShows && <div className="rounded-2xl border bg-card p-4" data-testid="v8-next-fallback">
          <div className="text-sm font-bold">Next step</div>
          {s.next ? (<>
            <div className="mt-2 text-lg font-extrabold">{s.next.title}</div>
            <div className="text-sm text-muted-foreground">{s.next.sub}</div>
            <Button variant="outline" className="mt-3 w-full" onClick={() => navigate(s.next!.to)}>{s.next.btn === "Book" ? "Book install" : s.next.btn === "Open deposit" ? "Take deposit" : s.next.btn === "Follow up" ? "Follow up" : "Open quote"}</Button>
          </>) : <div className="mt-2 text-sm text-muted-foreground">Nothing waiting. Nice.</div>}
        </div>}
      </div>
      <div className="rounded-2xl border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-bold">The flow · all open deals, incl. VAT</span>
          <button className="text-xs font-semibold text-[#1590d6]" onClick={() => navigate("/admin/jobs?tab=pipeline")}>Open pipeline →</button></div>
        <div className="v8-flow">
          {V8_COLS.filter((c) => !(own && c.key === "lead")).map((c) => (
            <button key={c.key} onClick={() => navigate(c.key === "lead" ? "/admin/dispatch" : "/admin/jobs?tab=pipeline")}>
              <div className="text-xs opacity-70">{c.label}</div>
              <div className="text-lg font-bold tabular-nums">{s.count[c.key] || 0}</div>
              <div className="text-xs opacity-60 tabular-nums">{c.key === "lead" ? "R —" : c.key === "invoiced" ? `${fmtRandShort(invoicedOwed)} owed` : fmtRandShort(s.value[c.key] || 0)}</div>
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
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{n.title}</span><span className="block truncate text-xs text-muted-foreground">{n.tag === "I" && out.data?.byQuote?.[n.id] != null ? `Invoiced · ${fmtRandShort(out.data.byQuote[n.id])} still owed` : n.sub}</span></span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(n.to)}>{n.btn}</Button>
            </div>))}
          {s.needs.length === 0 && <div className="py-2 text-sm text-muted-foreground">All clear.</div>}
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { useLeadInbox } from "@/hooks/useLeadInbox";
import { useLinkedAdmin } from "@/hooks/useLinkedAdmin";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { homeScope, quoteInScope } from "@/lib/homeScope";
import { Button } from "@/components/ui/button";
import { buildDeals, fmtRandShort } from "@/lib/quotePipeline";
import { V8_COLS, v8ColOf, type V8Col } from "@/lib/v8Flow";
import { usePipelineData, nameOf } from "@/components/jobs/PipelineBoard";
import type { V8Role } from "./v8Nav";
import V8NumberRow from "./V8NumberRow";
import SalesHeartbeat from "@/components/heartbeat/SalesHeartbeat";
import { useHeartbeatAudience } from "@/hooks/useSalesHeartbeat";
import { InvoiceApprovalHomeCard } from "@/components/invoicing/InvoiceApprovalPanel";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invoiceMoney } from "@/lib/moneySummary";
import { isUnpaid } from "@/lib/unpaidBuckets";
import { fetchCreditNotes } from "@/lib/creditNotes";
import { countAdminHome, inSignedInCompany, monthChangePct, TEST_HVAC_ID, thenInOrderDetail, type CountFigure, type HomeQuote } from "@/lib/adminHomeCount";
import { greetingTitle } from "@/lib/roleHome";
import { AdminHomePies, HowCountedSheet, InfoMark, InvoicesWaitingCard, useAdminHomeFigures, type AdminHomeSource } from "./AdminHomeFigures";
import { cn } from "@/lib/utils";
import "./v8.css";

/** p112: Outstanding = balance owing after payments and credits on every unpaid invoice (same rule as Invoices > Unpaid).
 *  ownQuoteIds = plain rep: only invoices on their own quotes; null = company-wide.
 *  companyId, when known, keeps another company's rows out of the total. */
function useHomeOutstanding(ownQuoteIds: string[] | null, companyId: string | null) {
  return useQuery({
    queryKey: ["v8-home-outstanding", companyId ?? "session", ownQuoteIds ? ownQuoteIds.join(",") : "all"],
    refetchInterval: 60_000,
    queryFn: async () => {
      let req = (supabase.from("invoices") as any).select("id, quote_id, status, grand_total, notes, archived_at, company_id").not("status", "in", "(paid,void,cancelled,draft)").limit(2000);
      if (companyId) req = req.eq("company_id", companyId);
      const { data: inv } = await req;
      const rows = ((inv || []) as any[]).filter((i) => !i.archived_at && (!companyId || inSignedInCompany(i.company_id, companyId)) && (!ownQuoteIds || (i.quote_id && ownQuoteIds.includes(i.quote_id))));
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

type Item = { id: string; title: string; sub: string; btn: string; to: string; tag: string; detail?: string };

/** v8 Simple home (New layout only): hero · Next up · flow strip · New leads · Needs you today.
 *  Read-only over the existing pipeline + lead inbox queries; RLS scopes rows (company admins see only their company, sales only theirs). */
export default function V8RoleHome({ role, hideRequests, companyId: companyIdProp, figureSource, hideGreeting, hideInvoiceBanner }: { role: V8Role; hideRequests?: boolean; companyId?: string | null; figureSource?: AdminHomeSource; hideGreeting?: boolean; hideInvoiceBanner?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const identity = useSignedInIdentity();
  const { data } = usePipelineData();
  const { leads: inbox, count: inboxCount } = useLeadInbox();
  const linked = useLinkedAdmin();
  const loadedCompany = useUserCompanyId();
  const companyId = companyIdProp ?? loadedCompany.companyId;
  const companyLoading = companyIdProp ? false : loadedCompany.loading;
  const showFigures = role === "admin" || role === "owner";
  const figures = useAdminHomeFigures(showFigures && !figureSource ? companyId : null);
  const figureData = figureSource ?? figures.source;
  const [sheet, setSheet] = useState<CountFigure | null>(null);
  const [openNeed, setOpenNeed] = useState<string | "default">("default");
  // p117 (Johan "Merge into one"): the heartbeat "Next step" card (one button + Then, tap = pop-up) is the only next-step card when it shows.
  const hbAud = useHeartbeatAudience();
  const hbShows = role !== "tech" && hbAud.canSee;
  // Sales login linked to an admin account counts company-wide; a plain rep counts their own quotes.
  const own = homeScope(role, linked.data) === "own";
  const s = useMemo(() => {
    const out = { count: {} as Record<V8Col, number>, value: {} as Record<V8Col, number>, month: 0, prevMonth: 0, drafts: 0, invoicedIds: [] as string[], needs: [] as Item[], next: null as Item | null };
    if (!data) return out;
    const qs = data.quotes.filter((q) => quoteInScope(q, own ? "own" : "company", user?.id) && (!showFigures || !companyId || inSignedInCompany(q.company_id, companyId)));
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
      const detail = thenInOrderDetail(d.quote, d.value);
      if (c === "accepted") accepted.push({ id: d.quote.id, title: `${d.depositDue ? "Deposit due" : "Book the job"} · ${n}`, sub: `${num} accepted · ${fmtRandShort(d.value)}`, btn: d.depositDue ? "Open deposit" : "Book", to, tag: "J", detail });
      if (d.stage === "viewed") viewed.push({ id: d.quote.id, title: `${num} · ${n}`, sub: "Viewed · not accepted yet", btn: "Follow up", to, tag: "Q", detail });
      if (c === "invoiced") unpaid.push({ id: d.quote.id, title: `${num} · ${n}`, sub: "Invoiced · waiting for payment", btn: "Remind", to, tag: "I", detail });
    });
    const quoted = new Set(data.quotes.map((q) => q.lead_id).filter(Boolean));
    out.count.lead = own ? 0 : data.leads.filter((l) => !quoted.has(l.id)).length;
    out.next = accepted[0] || viewed[0] || null;
    out.needs = [...accepted.slice(1, 3), ...viewed.slice(0, 2), ...unpaid.slice(0, 2)].slice(0, 5);
    return out;
  }, [data, own, user?.id, showFigures, companyId]);
  const now = new Date();
  const ownIds = useMemo(() => (own && data ? data.quotes.filter((q) => q.sales_engineer_id === user?.id).map((q) => q.id) : null), [own, data, user?.id]);
  const out = useHomeOutstanding(ownIds, companyId);
  const outstanding = out.data?.total ?? 0;
  const monthName = new Date().toLocaleDateString("en-ZA", { month: "long" });
  const prevName = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString("en-ZA", { month: "long" }); })();
  const counts = useMemo(() => {
    if (!showFigures || !companyId || !data) return null;
    return countAdminHome({
      companyId,
      invoices: figureData?.invoices,
      payments: figureData?.payments,
      credits: figureData?.credits,
      jobs: figureData?.jobs,
      quotes: data.quotes.map((q) => ({ ...q, customer_name: nameOf(q) })) as HomeQuote[],
      quoteInvoices: data.invoices as any,
      quoteJobs: data.jobs as any,
    });
  }, [showFigures, companyId, data, figureData]);
  const moneyReady = !!figureData || companyId === TEST_HVAC_ID;
  const openTotal = (counts ? counts.open.total : s.value.quote) || 0; // sent or viewed only, option groups once
  const acceptedMonth = counts ? counts.accepted.total : s.month;
  const acceptedPrev = counts ? counts.previousAccepted : s.prevMonth;
  const draftCount = counts ? counts.draftsNotSent : s.drafts;
  const acceptedChange = counts ? monthChangePct(counts.accepted.total, counts.previousAccepted) : null;
  // p115 (Johan): the Invoiced tile shows the balance still owed on those invoices, not the quote value.
  const owedByQuote = moneyReady && counts ? counts.owedByQuote : out.data?.byQuote;
  const invoicedOwed = s.invoicedIds.reduce((t, id) => t + (owedByQuote?.[id] || 0), 0);
  const owedTotal = moneyReady && counts ? counts.owed.total : outstanding;
  const owedCount = moneyReady && counts ? counts.owed.count : (out.data?.count ?? 0);
  const openSheet = (f: CountFigure) => setSheet(f);
  const today = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short" });
  const ago = (t?: string) => { if (!t) return ""; const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

  return (
    <div className="space-y-4" data-testid={`v8-home-${role}`}>
      {!hideGreeting && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-[#1590d6]">{today}{role === "owner" && settings?.company_name ? ` · ${settings.company_name}` : ""}</div>
          <h1 className="text-2xl font-extrabold" data-testid="v8-role-greeting">{greetingTitle(now, identity?.name)}</h1>
        </div>
      )}
      {role === "sales" && <InvoiceApprovalHomeCard />}
      {!hideInvoiceBanner && showFigures && moneyReady && counts && counts.waiting.count > 0 && <InvoicesWaitingCard figure={counts.waiting} onOpen={() => openSheet(counts.waiting)} />}
      {showFigures && (!moneyReady || !counts || counts.waiting.count === 0) && <InvoiceApprovalHomeCard />}
      {role !== "tech" && <SalesHeartbeat hideRequests={hideRequests} />}
      {(role === "owner" || role === "admin") && <V8NumberRow />}
      <div className={hbShows ? "grid gap-3" : "grid gap-3 lg:grid-cols-[1.5fr_1fr]"}>
        <div className="v8-hero">
          {counts ? (
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm opacity-90">
                  <button type="button" onClick={() => navigate(counts.accepted.actionHref)}>Quotes accepted in {monthName} · incl. VAT</button>
                  <InfoMark label="How quotes accepted was counted" onClick={() => openSheet(counts.accepted)} />
                </div>
                <button type="button" className="text-left text-[40px] font-extrabold leading-none tabular-nums" data-testid="hero-accepted" onClick={() => navigate(counts.accepted.actionHref)}>{fmtRandShort(acceptedMonth)}</button>
                <div className="mt-1 text-xs opacity-80">{prevName}: {fmtRandShort(acceptedPrev)}{acceptedChange != null && <b className={acceptedChange >= 0 ? " text-[#86EFAC]" : " text-[#FECACA]"}>{acceptedChange >= 0 ? " ▲ " : " ▼ "}{Math.abs(acceptedChange)}%</b>}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:flex md:flex-col md:items-end md:text-right">
                <div data-testid="hero-open">
                  <div className="text-xs opacity-80">
                    <button type="button" onClick={() => navigate(counts.open.actionHref)}>Open quotes</button>
                    <InfoMark label="How open quotes was counted" onClick={() => openSheet(counts.open)} />
                  </div>
                  <button type="button" className="text-[26px] font-extrabold leading-none tabular-nums" onClick={() => navigate(counts.open.actionHref)}>{fmtRandShort(openTotal)}</button>
                  {draftCount > 0 && <div className="text-xs opacity-80">Drafts not sent: {draftCount}</div>}
                </div>
                <div data-testid="hero-outstanding">
                  <div className="text-xs opacity-80">
                    <button type="button" onClick={() => navigate(moneyReady ? counts.owed.actionHref : "/admin/invoices?state=unpaid")}>Owed on unpaid invoices</button>
                    <InfoMark label="How owed was counted" onClick={() => (moneyReady ? openSheet(counts.owed) : navigate("/admin/invoices?state=unpaid"))} />
                  </div>
                  <button type="button" className="text-[26px] font-extrabold leading-none tabular-nums" onClick={() => navigate(moneyReady ? counts.owed.actionHref : "/admin/invoices?state=unpaid")}>{fmtRandShort(owedTotal)}</button>
                  <div className="text-xs opacity-80">{owedCount} invoice{owedCount === 1 ? "" : "s"} · all dates →</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-sm opacity-90">{own ? "My quotes accepted" : "Quotes accepted"} in {monthName} · incl. VAT</div>
              <div className="text-[28px] leading-[34px] font-extrabold tabular-nums" data-testid="hero-accepted">{fmtRandShort(acceptedMonth)}</div>
              <div className="text-xs opacity-80">{prevName}: {fmtRandShort(acceptedPrev)} <span title="By accepted date, incl. VAT" className="cursor-help">ⓘ</span></div>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-2 text-sm">
                <span className="opacity-85" data-testid="hero-open">Open quotes {fmtRandShort(openTotal)} <span title="Sent or viewed, not accepted yet. Option groups count once. Incl. VAT." aria-label="About open quotes" className="cursor-help">ⓘ</span>{draftCount > 0 && <span className="block text-xs opacity-80">Drafts not sent: {draftCount}</span>}</span>
                <button type="button" className="text-right" onClick={() => navigate("/admin/invoices?state=unpaid")} data-testid="hero-outstanding"><span className="block text-xs opacity-80">Owed on unpaid invoices · incl. VAT</span><span className="text-xl font-bold tabular-nums">{fmtRandShort(owedTotal)}</span><span className="block text-xs opacity-80">{owedCount} invoice{owedCount === 1 ? "" : "s"} · all dates →</span></button>
              </div>
            </>
          )}
          {own && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate("/admin/my-commission")}>My commission</Button>}
        </div>
        {!hbShows && <div className="rounded-2xl border-2 border-[#C2410C] bg-card p-5" data-testid="v8-next-fallback">
          <div className="text-sm font-bold">Next step</div>
          {s.next ? (<>
            <div className="mt-2 text-lg font-extrabold">{s.next.title}</div>
            <div className="text-sm text-muted-foreground">{s.next.sub}</div>
            <button type="button" className="fl-btn-primary mt-3 w-full" onClick={() => navigate(s.next!.to)}>{s.next.btn === "Book" ? "Book install" : s.next.btn === "Open deposit" ? "Take deposit" : s.next.btn === "Follow up" ? "Follow up" : "Open quote"}</button>
            <button type="button" className="fl-btn-text" onClick={() => navigate(s.next!.to)}>Open quote</button>
          </>) : <div className="mt-2 text-sm text-muted-foreground">Nothing waiting. Nice.</div>}
        </div>}
      </div>
      {showFigures && moneyReady && counts && <AdminHomePies counts={counts} onOpen={openSheet} />}
      {showFigures && !moneyReady && !figures.isError && (companyLoading || !!companyId) && <div className="h-28 animate-pulse rounded-2xl bg-card" data-testid="admin-home-pies-loading" />}
      {showFigures && figures.isError && <p className="text-sm text-muted-foreground">Couldn&apos;t load this month&apos;s work and money pies.</p>}
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
          <div className="mb-1 flex items-center justify-between"><span className="text-sm font-bold">Then, in order</span></div>
          {s.needs.slice(0, 3).map((n, i) => {
            const key = n.id + n.btn;
            const expanded = showFigures && (openNeed === "default" ? i === 0 : openNeed === key);
            const sub = n.tag === "I" && owedByQuote?.[n.id] != null ? `Invoiced · ${fmtRandShort(owedByQuote[n.id])} still owed` : n.sub;
            return (
              <div key={key} className={cn("border-t py-2 text-sm first:border-t-0", expanded && "-mx-2 rounded-lg bg-[#F3F6FA] px-2 dark:bg-muted/40")} data-testid={i === 0 ? "then-first" : undefined}>
                <div className="flex min-h-[56px] items-center gap-2">
                  {showFigures && (
                    <button type="button" aria-expanded={expanded} aria-label={expanded ? "Hide details" : "Show details"} className="w-5 shrink-0 text-left font-bold" onClick={() => setOpenNeed(expanded ? "" : key)}>{expanded ? "▾" : "▸"}</button>
                  )}
                  <Link to={n.to} className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{n.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                  </Link>
                  <button type="button" className="fl-btn-secondary text-[14px]" onClick={() => navigate(n.to)}>{n.btn}</button>
                </div>
                {expanded && n.detail && <div className="mt-1 rounded-lg border bg-white px-2 py-1.5 text-xs text-[#0F1B2A] dark:bg-card dark:text-inherit" data-testid="then-detail">{n.detail}</div>}
              </div>
            );
          })}
          {s.needs.length === 0 && <div className="py-2 text-sm text-muted-foreground">All clear.</div>}
        </div>
      </div>
      {sheet && <HowCountedSheet figure={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

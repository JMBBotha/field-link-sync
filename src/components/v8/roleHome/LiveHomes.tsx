import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { refreshOnVisit } from "@/lib/queryDefaults";
import { supabase } from "@/integrations/supabase/client";
import { HowCountedSheet, useAdminHomeFigures } from "@/components/v8/AdminHomeFigures";
import { parseMyJobs } from "@/components/jobs/SalesMyJobs";
import { useMyAppointments } from "@/hooks/useMyAppointments";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { appointmentLinks } from "@/lib/appointments";
import { cardHref } from "@/lib/assignedLabel";
import { isFirstQuoteVisit } from "@/lib/materialCheck";
import { ADMIN_HOME_ROUTES, areaFromAddress, cashProjectionSlices, durationAbout, greetingEyebrow, greetingTitle, jobTypeWord } from "@/lib/roleHome";
import { checkKindOf } from "@/lib/materialCheck";
import { countsFor, useAdminRoleData, useMaterialCheck } from "./data";
import { SalesJobScreen } from "./screens";
import RoleMapFrame from "./RoleMapFrame";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import { formatRand } from "@/utils/formatRand";
import { fmtHomeRand } from "@/lib/adminHomeCount";
import type { ExpectedDraft } from "./ExpectedMoneyBand";
import { useYardHome } from "./yardData";
import { useOpenLeadActions } from "./openLeadActions";
import { AdminHomeScreen, SalesHomeScreen, YardViewScreen } from "./screens";
import { PurchaseOrderPreview } from "@/components/purchasing/PurchaseOrderPreview";
import { useUnitPurchaseOrder } from "@/components/purchasing/useUnitPurchaseOrder";

const db = supabase as unknown as {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
    update: (row: Record<string, unknown>) => { eq: (c: string, v: string) => { in: (c: string, v: string[]) => Promise<{ error: { message?: string } | null }> } };
  };
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: { total?: number } | null; error: { message?: string } | null }>;
};

function useExpectedActions(companyId: string | null | undefined) {
  const qc = useQueryClient();
  const add = async (draft: ExpectedDraft) => {
    if (!companyId) throw new Error("No company.");
    const amount = Math.round(Number(draft.amount) * 100) / 100;
    if (!(amount > 0)) throw new Error("Amount must be more than zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw new Error("Expected date is required.");
    const { error } = await db.from("cf_receipts").insert({
      company_id: companyId,
      source: "manual",
      part: draft.kind,
      amount_incl: amount,
      vat_incl: 0,
      expected_date: draft.date,
      client: draft.client.trim() || null,
      invoice_id: draft.invoiceId || null,
      note: draft.note.trim() || null,
      ref: draft.client.trim() || "Expected",
      status: "expected",
      confidence: 60,
      leeway_days: 7,
    });
    if (error) throw new Error(/check constraint|other|cancelled/i.test(error.message || "") ? "The expected-money update is not on the database yet." : (error.message || "Could not save that."));
    await qc.invalidateQueries({ queryKey: ["yard-books", companyId] });
  };
  const setStatus = async (id: string, status: "received" | "cancelled") => {
    if (!companyId) return;
    const patch = status === "received" ? { status, received_date: todayInJohannesburg() } : { status };
    const { error } = await db.from("cf_receipts").update(patch).eq("id", id).in("source", ["manual", "walda"]);
    if (error) throw new Error(error.message || "Could not update that.");
    await qc.invalidateQueries({ queryKey: ["yard-books", companyId] });
  };
  return { add, setStatus };
}

function usePoolOnHand(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ["pool-on-hand", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await db.rpc("material_pool_on_hand");
      if (error || data?.total == null || !Number.isFinite(Number(data.total))) return null;
      return fmtHomeRand(Number(data.total));
    },
  });
}

function stockScreen(href: string): string {
  return href.includes("/admin/cash-health") ? href : ADMIN_HOME_ROUTES.stock;
}

export function AdminLiveHome() {
  const navigate = useNavigate();
  const identity = useSignedInIdentity();
  const { companyId, companyLoading, figures, crew, needs } = useAdminRoleData();
  const yard = useYardHome(companyId, figures.source, figures.isLoading);
  const counts = countsFor(companyId, figures.source);
  const [open, setOpen] = useState<null | "waiting" | "deposit" | "final">(null);
  const leads = useOpenLeadActions();
  const money = useExpectedActions(companyId);
  const pool = usePoolOnHand(companyId);
  const purchase = useUnitPurchaseOrder();
  const now = new Date();
  const invoices = (figures.source?.invoices || [])
    .filter((inv) => inv.id)
    .slice(0, 80)
    .map((inv) => ({ id: inv.id, label: [inv.invoice_number, inv.customer_name].filter(Boolean).join(" · ") || "Invoice" }));
  const slices = counts ? cashProjectionSlices(counts) : [];
  const figure = open && counts ? (open === "waiting" ? counts.waiting : open === "deposit" ? counts.deposit : counts.finalDue) : null;
  return (
    <>
      <AdminHomeScreen
        eyebrow={greetingEyebrow(now)}
        title={greetingTitle(now, identity?.name)}
        companyName={yard.companyName}
        invoice={counts && counts.waiting.count > 0 ? { count: counts.waiting.count, total: formatRand(counts.waiting.total).replace(/^R\s/, "R") } : null}
        crew={(crew.data || []).map((c) => ({ ...c, type: jobTypeWord(c.type), where: areaFromAddress(c.where) }))}
        levels={(needs.data?.levels || []).map((l) => ({ ...l, href: stockScreen(l.href) }))}
        orders={(needs.data?.orders || []).map((o) => ({ ...o, href: ADMIN_HOME_ROUTES.stock }))}
        unitRows={needs.data?.unitRows || []}
        stockCount={needs.data?.nagCount}
        onCreatePo={purchase.open}
        onReviewPo={purchase.open}
        busyJobId={purchase.busyJobId}
        slices={slices}
        poolOnHand={pool.data}
        invoices={invoices}
        onAddExpected={money.add}
        onExpectedStatus={money.setStatus}
        model={yard.model}
        modelLoading={yard.loading || (companyLoading && !yard.model)}
        onSlice={(s) => navigate(s.figure.actionHref)}
        onSliceInfo={(s) => setOpen(s.key)}
        onReview={() => navigate(counts?.waiting.actionHref || ADMIN_HOME_ROUTES.reviewSend)}
        onInvoice={() => setOpen("waiting")}
        leadActions={leads.actions}
      />
      {purchase.drafts && (
        <PurchaseOrderPreview
          companyName={purchase.companyName}
          drafts={purchase.drafts}
          emails={purchase.emails}
          onEmails={(poId, value) => purchase.setEmails((current) => ({ ...current, [poId]: value }))}
          onSend={purchase.send}
          onClose={purchase.close}
          sending={purchase.sending}
          missingPrice={purchase.missingPrice}
        />
      )}
      {leads.dialogs}
      {figure && <HowCountedSheet figure={figure} onClose={() => setOpen(null)} />}
    </>
  );
}

export function YardLiveHome() {
  const navigate = useNavigate();
  const identity = useSignedInIdentity();
  const { companyId } = useUserCompanyId();
  const figures = useAdminHomeFigures(companyId);
  const yard = useYardHome(companyId, figures.source, figures.isLoading);
  const money = useExpectedActions(companyId);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const counts = countsFor(companyId, figures.source);
  return (
    <>
      <YardViewScreen
        eyebrow={greetingEyebrow(now)}
        title={greetingTitle(now, identity?.name)}
        companyName={yard.companyName}
        invoice={counts && counts.waiting.count > 0 ? { count: counts.waiting.count, total: formatRand(counts.waiting.total).replace(/^R\s/, "R") } : null}
        model={yard.model}
        loading={yard.loading}
        error={yard.error}
        onReview={() => navigate(counts?.waiting.actionHref || ADMIN_HOME_ROUTES.reviewSend)}
        onInvoice={() => setOpen(true)}
        onAddExpected={money.add}
        onExpectedStatus={money.setStatus}
      />
      {open && counts && <HowCountedSheet figure={counts.waiting} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SalesLiveHome() {
  const today = todayInJohannesburg();
  const appts = useMyAppointments(14);
  const booked = useQuery({
    queryKey: ["sales-my-jobs"],
    ...refreshOnVisit,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_my_jobs", { p_limit: 50 });
      if (error) throw error;
      return parseMyJobs(data);
    },
  });
  const identity = useSignedInIdentity();
  const now = new Date();
  const appointments = (appts.data || []).filter((a) => a.scheduled_date === today).map((a) => {
    const visit = isFirstQuoteVisit({ serviceType: a.service_type, source: a.source });
    const links = appointmentLinks(a);
    return {
      id: `${a.lead_id}-${a.scheduled_date}`,
      href: links.lead,
      time: a.scheduled_time ? a.scheduled_time.slice(0, 5) : "Time TBC",
      type: visit ? "Quote visit" : jobTypeWord(a.service_type),
      place: [areaFromAddress(a.address), a.customer_name || "Client"].filter(Boolean).join(" · "),
      chip: visit ? { label: "No technician yet" as const, tone: "neutral" as const } : null,
    };
  });
  return (
    <SalesHomeScreen
      eyebrow={greetingEyebrow(now)}
      title={greetingTitle(now, identity?.name)}
      appointments={appointments}
      booked={(booked.data || []).map((j) => ({
        id: j.job_id || j.lead_id || "job",
        href: cardHref(j) || "/admin/jobs",
        when: j.scheduled_date
          ? new Date(`${j.scheduled_date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })
          : "Booked",
        type: jobTypeWord(j.job_types?.[0], j.title),
        client: j.customer || "Client",
        area: j.title || "Job",
        tech: j.tech_name,
      }))}
    />
  );
}

type SalesLookJob = {
  id: string;
  job_type?: string | null;
  title?: string | null;
  quote_id?: string | null;
  lead_id?: string | null;
  address?: string | null;
  scheduled_for?: string | null;
  estimated_duration?: string | null;
  description?: string | null;
  customer_locations?: { address?: string | null } | null;
  customers?: { name?: string | null; phone?: string | null; address?: string | null } | null;
};

export function SalesJobLook({ job, techName }: { job: SalesLookJob; techName?: string | null }) {
  const kind = checkKindOf({ jobType: job.job_type, title: job.title });
  const check = useMaterialCheck(job.id, kind, job.quote_id, job.lead_id);
  const address = job.customer_locations?.address || job.address || job.customers?.address || null;
  const when = job.scheduled_for
    ? new Date(job.scheduled_for).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" })
    : "Time not set";
  return (
    <RoleMapFrame>
      <SalesJobScreen
        type={jobTypeWord(job.job_type, job.title)}
        client={job.customers?.name || "Client"}
        area={areaFromAddress(address, job.title)}
        when={when}
        duration={durationAbout(job.estimated_duration)}
        tech={techName}
        phone={job.customers?.phone}
        address={address}
        navHref={address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null}
        check={check.data || { kind, show: kind !== "quote_visit", lines: [], toPickCount: 0 }}
        quoteHref={job.quote_id ? `/admin/estimates/${job.quote_id}` : `/admin/quotes?leadId=${job.lead_id || ""}`}
        description={job.description}
      />
    </RoleMapFrame>
  );
}

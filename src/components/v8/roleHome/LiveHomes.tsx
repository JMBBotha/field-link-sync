import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { useHomeMoney, useYardHome } from "./yardData";
import { AdminHomeScreen, SalesHomeScreen, YardViewScreen } from "./screens";

function stockScreen(href: string): string {
  return href.includes("/admin/cash-health") ? href : ADMIN_HOME_ROUTES.stock;
}

export function AdminLiveHome() {
  const navigate = useNavigate();
  const identity = useSignedInIdentity();
  const { companyId, figures, crew, needs } = useAdminRoleData();
  const money = useHomeMoney(companyId, figures.source, figures.isLoading);
  const counts = countsFor(companyId, figures.source);
  const [open, setOpen] = useState<null | "waiting" | "deposit" | "final">(null);
  const now = new Date();
  const slices = counts ? cashProjectionSlices(counts) : [];
  const figure = open && counts ? (open === "waiting" ? counts.waiting : open === "deposit" ? counts.deposit : counts.finalDue) : null;
  return (
    <>
      <AdminHomeScreen
        eyebrow={greetingEyebrow(now)}
        title={greetingTitle(now, identity?.name)}
        invoice={counts && counts.waiting.count > 0 ? { count: counts.waiting.count, total: formatRand(counts.waiting.total).replace(/^R\s/, "R") } : null}
        crew={(crew.data || []).map((c) => ({ ...c, type: jobTypeWord(c.type), where: areaFromAddress(c.where) }))}
        levels={(needs.data?.levels || []).map((l) => ({ ...l, href: stockScreen(l.href) }))}
        orders={(needs.data?.orders || []).map((o) => ({ ...o, href: ADMIN_HOME_ROUTES.stock }))}
        slices={slices}
        money={money.tiles}
        moneyLoading={money.loading}
        onSlice={(s) => navigate(s.figure.actionHref)}
        onSliceInfo={(s) => setOpen(s.key)}
        onReview={() => navigate(counts?.waiting.actionHref || ADMIN_HOME_ROUTES.reviewSend)}
        onInvoice={() => setOpen("waiting")}
      />
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

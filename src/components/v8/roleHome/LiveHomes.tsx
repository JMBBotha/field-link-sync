import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HowCountedSheet, useAdminHomeFigures } from "@/components/v8/AdminHomeFigures";
import { parseMyJobs } from "@/components/jobs/SalesMyJobs";
import { useMyAppointments } from "@/hooks/useMyAppointments";
import { appointmentLinks } from "@/lib/appointments";
import { cardHref } from "@/lib/assignedLabel";
import { isFirstQuoteVisit } from "@/lib/materialCheck";
import { countAdminHome } from "@/lib/adminHomeCount";
import { jhbGreetingTitle, YARD_LINKS } from "@/lib/yardView";
import { areaFromAddress, durationAbout, greetingEyebrow, greetingTitle, jobTypeWord } from "@/lib/roleHome";
import { checkKindOf } from "@/lib/materialCheck";
import { useMaterialCheck } from "./data";
import { SalesJobScreen } from "./screens";
import RoleMapFrame from "./RoleMapFrame";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import { formatRand } from "@/utils/formatRand";
import { useYardHome } from "./yardData";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { AdminHomeScreen, SalesHomeScreen } from "./screens";

export function AdminLiveHome() {
  const navigate = useNavigate();
  const { companyId } = useUserCompanyId();
  const figures = useAdminHomeFigures(companyId);
  const yard = useYardHome(companyId, figures.source, figures.isLoading);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const counts = companyId && figures.source
    ? countAdminHome({ companyId, invoices: figures.source.invoices, payments: figures.source.payments, credits: figures.source.credits, jobs: figures.source.jobs })
    : null;
  return (
    <>
      <AdminHomeScreen
        eyebrow={greetingEyebrow(now)}
        title={jhbGreetingTitle(now)}
        companyName={yard.companyName}
        invoice={counts ? { count: counts.waiting.count, total: formatRand(counts.waiting.total).replace(/^R\s/, "R") } : null}
        model={yard.model}
        loading={yard.loading}
        error={yard.error}
        onReview={() => navigate(counts?.waiting.actionHref || YARD_LINKS.invoicesDraft)}
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
      title={greetingTitle(now)}
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

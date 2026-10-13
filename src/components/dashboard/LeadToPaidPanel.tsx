import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, CheckCircle2, PauseCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useLeadSla } from "@/hooks/useLeadSla";
import { cn } from "@/lib/utils";
import { deriveFlow, nextUp, summarise, SALES_STAGES, STAGES, type FlowData, type FlowItem, type Urgency } from "@/lib/leadFlow";

// flow.md §10: one colour per row (stripe, pill, button), solid circles with the count inside. Orange = brand only.
export const URGENCY_CLASS: Record<Urgency, { bg: string; text: string; ring: string }> = {
  red: { bg: "bg-[#DC2626]", text: "text-white", ring: "ring-[#DC2626]/40" },
  yellow: { bg: "bg-[#EAB308]", text: "text-[#111827]", ring: "ring-[#EAB308]/40" },
  blue: { bg: "bg-[#2563EB]", text: "text-white", ring: "ring-[#2563EB]/40" },
  grey: { bg: "bg-[#6b7280]", text: "text-white", ring: "ring-[#6b7280]/40" },
};
export const URGENCY_ICON = { red: AlertCircle, yellow: Clock, blue: CheckCircle2, grey: PauseCircle } as const;

export function useLeadFlowData() {
  const { companyId } = useUserCompanyId();
  return useQuery({
    queryKey: ["lead-flow", companyId],
    enabled: !!companyId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<FlowData> => {
      const co = companyId as string;
      const since = new Date(Date.now() - 120 * 86400_000).toISOString();
      const [l, q, i, j, p] = await Promise.all([
        supabase.from("leads").select("id, customer_name, status, lead_status, source, primary_intent, service_type, created_at, first_contact_at, contact_attempts, scheduled_date, scheduled_time, deleted_at").eq("company_id", co).is("deleted_at", null).gte("created_at", since).limit(500),
        supabase.from("quotes").select("id, lead_id, customer_name, status, created_at, sent_at, accepted_at, declined_at, superseded_by, quote_number").eq("company_id", co).gte("created_at", since).limit(500),
        supabase.from("invoices").select("id, quote_id, lead_id, status, grand_total, deposit_amount, sent_at, created_at, due_date, invoice_number").eq("company_id", co).gte("created_at", since).limit(500),
        (supabase.from("jobs") as any).select("id, lead_id, quote_id, invoice_id, title, status, scheduled_for, started_at, completed_at, awaiting_stock, job_type").eq("company_id", co).gte("created_at", since).limit(500),
        supabase.from("payments").select("invoice_id, amount, status, created_at").eq("company_id", co).gte("created_at", since).limit(1000),
      ]);
      return { leads: (l.data as any) || [], quotes: (q.data as any) || [], invoices: (i.data as any) || [], jobs: (j.data as any) || [], payments: (p.data as any) || [] };
    },
  });
}

function Pill({ item }: { item: FlowItem }) {
  const c = URGENCY_CLASS[item.urgency], Icon = URGENCY_ICON[item.urgency];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold whitespace-nowrap", c.bg, c.text)}><Icon className="h-3.5 w-3.5" />{item.label}</span>;
}

export default function LeadToPaidPanel({ audience }: { audience: "office" | "sales" }) {
  const navigate = useNavigate();
  const { sla } = useLeadSla();
  const { data, isLoading } = useLeadFlowData();
  const now = Date.now();
  const items = useMemo(() => (data ? deriveFlow(data, now, sla) : []), [data, sla, Math.floor(now / 30_000)]); // 30s tick
  const scoped = audience === "sales" ? items.filter((i) => SALES_STAGES.includes(i.stage)) : items;
  const { stages, parked } = summarise(items);
  const next = nextUp(scoped);
  const shown = audience === "sales" ? STAGES.filter((s) => SALES_STAGES.includes(s)) : STAGES;

  return (
    <section data-testid="lead-to-paid" className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-xl border border-[#d6d9de] bg-[#eef0f3] p-4 text-[#111827] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <h2 className="text-base font-extrabold">Lead → Paid</h2>
          <span className="text-[11px] font-medium text-[#4b5563] dark:text-slate-300">circle colour = most urgent item in that stage</span>
        </div>
        <div className="relative mt-3 flex gap-1 overflow-x-auto pb-1 snap-x" role="list">
          <div className="pointer-events-none absolute left-6 right-6 top-[22px] hidden h-1 rounded bg-border sm:block" aria-hidden />
          {shown.map((name) => {
            const s = stages[STAGES.indexOf(name)];
            const c = URGENCY_CLASS[s.urgency];
            return (
              <div key={name} role="listitem" className="relative min-w-[64px] flex-1 snap-start text-center" title={`${name}: ${s.count}`}>
                {s.count > 0 ? (
                  <div className={cn("mx-auto flex h-11 w-11 items-center justify-center rounded-full text-base font-extrabold shadow-sm", c.bg, c.text)}>{s.count}</div>
                ) : (
                  <div className="mx-auto my-[13px] h-[18px] w-[18px] rounded-full bg-border" />
                )}
                <div className="mt-1.5 text-[11px] font-extrabold tracking-wide">{name}</div>
                {(s.red > 0 || s.yellow > 0) && (
                  <div className="text-[10px] font-semibold text-[#4b5563] dark:text-slate-300">{s.red > 0 ? `${s.red} overdue` : `${s.yellow} due soon`}</div>
                )}
              </div>
            );
          })}
        </div>
        {audience === "office" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#d6d9de] px-2.5 py-1 text-[11px] font-semibold text-[#1f2937] dark:bg-slate-700 dark:text-slate-100">No answer (3 tries) · {parked.no_answer}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#d6d9de] px-2.5 py-1 text-[11px] font-semibold text-[#1f2937] dark:bg-slate-700 dark:text-slate-100">Waiting for stock · {parked.waiting_stock}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#d6d9de] px-2.5 py-1 text-[11px] font-semibold text-[#1f2937] dark:bg-slate-700 dark:text-slate-100">Lost · {parked.lost}</span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-[#4b5563] dark:text-slate-300">
          <span><b className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#DC2626] align-middle" />! Overdue</span>
          <span><b className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#EAB308] align-middle" />◷ Due soon</span>
          <span><b className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#2563EB] align-middle" />✓ On time · your next step</span>
          <span><b className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#6b7280] align-middle" />Done / waiting on others</span>
        </div>
      </div>

      <div className="rounded-xl border border-[#d6d9de] bg-[#eef0f3] p-3 text-[#111827] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" data-testid="next-up">
        <h3 className="px-1 text-sm font-extrabold">Next up</h3>
        {isLoading ? <p className="p-2 text-xs text-[#4b5563] dark:text-slate-300">Loading…</p> : next.length === 0 ? (
          <p className="p-2 text-xs text-[#4b5563] dark:text-slate-300">Nothing waiting on you. 👍</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {next.map((i, idx) => {
              const c = URGENCY_CLASS[i.urgency];
              return (
                <li key={i.key} className="flex items-center gap-2 py-2">
                  <span className={cn("h-9 w-1 shrink-0 rounded", c.bg)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 break-words leading-snug text-[13px] font-bold" title={i.client}>{i.client}</div>
                    <div className="mt-0.5 flex items-center gap-1.5"><span className="text-[10px] font-extrabold text-[#4b5563] dark:text-slate-300">{i.stage}</span><Pill item={i} /></div>
                  </div>
                  <span className="relative shrink-0">{idx === 0 && <span aria-hidden className={cn("absolute inset-0 animate-ping rounded-lg opacity-40", c.bg)} />}<button onClick={() => navigate(i.href)}
                    className={cn("relative rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold", c.bg, c.text)}>
                    {i.action}
                  </button></span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

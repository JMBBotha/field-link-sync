import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, X, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import CallSummary from "@/components/leads/CallSummary";
import EntityDetailsForm from "@/components/entity/EntityDetailsForm";
import JobTimeline from "@/components/JobTimeline";
import { oneLineSummary } from "@/lib/callSummary";
import { leadClock, hm } from "@/lib/leadClock";
import { useLeadSla, useNow } from "@/hooks/useLeadSla";
import { laneOf } from "@/lib/leadLane";
import { VAT_RATE } from "@/lib/pricing";

/**
 * Lead page C (Johan 20 Oct 10:43): one shared lead layout for the dispatch pop-up, the map sheet and the field sheet.
 * B look (dark-blue header, client, lane, two clocks, Lead→Paid progress bar, phone sticky next-step bar) with
 * A order: summary header → call summary bullets → next step → read-only details (Edit) → [extra] → history.
 * Presentation only: every action is a callback from the caller, nothing here writes except the existing EntityDetailsForm.
 */
export type NextAction = { label: string; onClick: () => void; disabled?: boolean; testId?: string };
export type LeadPageCProps = {
  lead: any;
  /** Tech (field_agent only) view: says "Job", hides the lead response clock and office wording. */
  techView?: boolean;
  /** Next step: title line plus primary + optional secondary actions (existing handlers from the caller). */
  next?: { title: string; primary?: NextAction; secondary?: NextAction[]; note?: string } | null;
  /** Render the sticky phone bar from `next` (off when the caller already has its own sticky bar). */
  stickyBar?: boolean;
  /** Extra caller sections between Details and History (quotes, photos, parts, job actions...). */
  children?: ReactNode;
  /** Extra line(s) under the client in the header (e.g. booked line, timing chip). */
  headerExtra?: ReactNode;
  /** Fields for the Edit form (EntityDetailsForm visibleFields). */
  editFields: string[];
  canEdit?: boolean;
  onClose?: () => void;
  /** Extra collapsible sections after history (time, comms). */
  after?: ReactNode;
  stage?: number;
  className?: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "New", open: "New", released: "Released", claimed: "Accepted", accepted: "Accepted",
  in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", lost: "Lost", parked: "Parked",
};

/** Call-out fee incl VAT from company settings (default_hourly_rate is the 1-hour call-out rate, excl VAT). */
export function useCallOutFeeIncl(): number | null {
  const { data } = useQuery({
    queryKey: ["company-callout-rate"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase.from("company_settings").select("default_hourly_rate").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return (data as any)?.default_hourly_rate ?? null;
    },
  });
  const r = Number(data);
  return Number.isFinite(r) && r > 0 ? Math.round(r * (1 + VAT_RATE)) : null;
}

/** 0 Lead · 1 Visit/Call-out · 2 Quote · 3 Accepted · 4 Job · 5 Paid (from lead fields only; callers may override). */
export function leadStageC(lead: any, opts: { quoteStatus?: string | null; invoiceStatus?: string | null } = {}): number {
  if (opts.invoiceStatus === "paid") return 5;
  if (lead?.status === "in_progress" || lead?.status === "completed" || lead?.converted_job_id) return 4;
  if (opts.quoteStatus === "accepted") return 3;
  if (opts.quoteStatus && ["sent", "viewed"].includes(opts.quoteStatus)) return 2;
  if (lead?.assigned_agent_id || lead?.scheduled_date || ["claimed", "accepted"].includes(lead?.status)) return 1;
  return 0;
}

const fmtRand = (n: number) => `R${n.toLocaleString("en-ZA").replace(/,/g, " ")}`;
export const callOutTitle = (fee: number | null) => (fee ? `Book call-out (${fmtRand(fee)} incl VAT)` : "Book call-out");

function Kv({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === "") return null;
  return (<><dt className="text-ink-muted text-[13px]">{k}</dt><dd className="min-w-0 break-words text-sm">{v}</dd></>);
}

export default function LeadPageC({ lead, techView, next, stickyBar = true, children, headerExtra, editFields, canEdit = true, onClose, after, stage, className }: LeadPageCProps) {
  const [editing, setEditing] = useState(false);
  const { sla } = useLeadSla();
  const now = useNow();
  const lane = laneOf(lead);
  const clock = techView ? null : leadClock(lead, now, sla);
  const ageMs = lead?.created_at ? now - Date.parse(lead.created_at) : null;
  const st = stage ?? leadStageC(lead);
  const steps = ["Lead", lane === "service" ? "Call-out" : "Visit", "Quote", "Accepted", "Job", "Paid"];
  const laneLabel = techView ? "Job" : lane === "sales" ? "Sales · Install quote" : lane === "service" ? "Tech · Call-out" : "Lead";
  const hasSummary = !!oneLineSummary(lead);
  const contact = [lead?.customer_phone, lead?.email, lead?.customer_address].filter(Boolean).join(" · ");
  const card = "rounded-[14px] border border-border bg-card p-4 sm:p-5";
  const h2 = "mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted";

  return (
    <div className={cn("space-y-4", className)} data-testid="lead-page-c">
      {/* 1. Summary header (B look) */}
      <section className="rounded-[14px] bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white sm:p-5" data-testid="lead-c-header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight sm:text-[25px] break-words">{lead?.customer_name || "Unnamed client"}</h1>
            {contact && <p className="mt-1 text-[13px] text-[#CFE6F6] break-words">{contact}</p>}
            {lead?.service_type && <p className="mt-0.5 text-[13px] text-[#CFE6F6] break-words">{lead.service_type}</p>}
            {headerExtra}
          </div>
          <div className="flex shrink-0 items-start gap-1.5">
            <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#1590D6]" data-testid="lead-c-lane">{laneLabel}</span>
              <span className="rounded-full bg-[#FFF4E0] px-2.5 py-1 text-xs font-semibold text-[#B26A00]">{STATUS_LABEL[lead?.status] ?? lead?.status ?? "—"}</span>
            </div>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-white/80 hover:bg-white/10"><X className="h-4 w-4" /></button>
            )}
          </div>
        </div>
        <div className="mt-3.5 flex gap-2.5">
          {!techView && (
            <div className="min-w-0 flex-1 rounded-xl border border-white/25 px-3 py-2 sm:max-w-[200px]" data-testid="lead-c-clock">
              <span className="block text-xs text-[#CFE6F6]">{clock ? (clock.stage === 1 ? `Respond within ${sla.contactMinutes} min` : clock.stage === 2 ? `${clock.stage2Label} clock` : "Response") : "Response"}</span>
              <b className="block text-lg leading-tight">{clock ? clock.big : lead?.status === "pending" ? "—" : "Contacted"}</b>
              {clock?.sub && <span className="block truncate text-[11px] text-[#CFE6F6]">{clock.sub}</span>}
            </div>
          )}
          <div className="min-w-0 flex-1 rounded-xl border border-white/25 px-3 py-2 sm:max-w-[200px]">
            <span className="block text-xs text-[#CFE6F6]">{techView ? "Created" : "Lead age"}</span>
            <b className="block text-lg leading-tight">{ageMs != null ? hm(ageMs) : "—"}</b>
          </div>
        </div>
        <div className="mt-3.5 flex gap-1.5" aria-label={`Stage: ${steps[st]}`}>
          {steps.map((s, i) => <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= st ? "bg-white" : "bg-white/25")} />)}
        </div>
        <p className="mt-1.5 text-xs text-[#CFE6F6]">{steps.join(" → ")}</p>
      </section>

      {/* 2. Call summary (bullets, transcript behind a link) */}
      {hasSummary && (
        <section className={card} data-testid="lead-c-summary">
          <h2 className={h2}>{techView ? "What the client needs" : "Call summary"}</h2>
          <CallSummary lead={lead} bullets />
        </section>
      )}

      {/* 3. Next step */}
      {next && (
        <section className="rounded-[14px] border-2 border-[#1590D6] bg-[#F3FAFE] p-4 dark:bg-sky-950/30 sm:p-5" data-testid="lead-c-next">
          <h2 className={h2}>Next step</h2>
          <p className="mb-2.5 text-sm font-semibold">{next.title}</p>
          {(next.primary || next.secondary?.length) && (
            <div className={cn("flex-wrap gap-2", stickyBar ? "hidden md:flex" : "flex")}>
              {next.primary && <Button variant="brand" onClick={next.primary.onClick} disabled={next.primary.disabled} data-testid={next.primary.testId}>{next.primary.label}</Button>}
              {next.secondary?.map((a) => <Button key={a.label} variant="outline" onClick={a.onClick} disabled={a.disabled} data-testid={a.testId}>{a.label}</Button>)}
            </div>
          )}
          {next.note && <p className="mt-2.5 text-[13px] text-ink-muted">{next.note}</p>}
        </section>
      )}

      {/* 4. Details: read-only, Edit opens the existing inline-save form */}
      <section className={card} data-testid="lead-c-details">
        <div className="mb-3 flex items-center justify-between">
          <h2 className={cn(h2, "mb-0")}>Details</h2>
          {canEdit && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[#1590D6]" onClick={() => setEditing((e) => !e)} data-testid="lead-c-edit">
              <Pencil className="mr-1 h-3.5 w-3.5" />{editing ? "Done" : "Edit"}
            </Button>
          )}
        </div>
        {editing ? (
          <EntityDetailsForm entityType="lead" entityId={lead.id} initialData={lead} readOnly={!canEdit} visibleFields={editFields as any} />
        ) : (
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 sm:grid-cols-[140px_1fr]">
            <Kv k="Phone" v={lead?.customer_phone && <a className="text-[#1590D6]" href={`tel:${lead.customer_phone}`}>{lead.customer_phone}</a>} />
            <Kv k="Email" v={lead?.email} />
            <Kv k="Address" v={lead?.customer_address} />
            <Kv k="Service" v={lead?.service_type} />
            <Kv k="Priority" v={lead?.priority && lead.priority !== "normal" ? lead.priority : null} />
            <Kv k="Scheduled" v={[lead?.scheduled_date, lead?.scheduled_time && String(lead.scheduled_time).slice(0, 5)].filter(Boolean).join(" · ")} />
            <Kv k="Order" v={lead?.order_status} />
            <Kv k="Parts" v={lead?.parts_status} />
            <Kv k="Notes" v={lead?.notes && !/(^|\n)\s*(Transcript:\s*)?(User|AI):|CallSid:|Vapi call:/i.test(lead.notes) ? <span className="whitespace-pre-wrap">{lead.notes}</span> : null} />
          </dl>
        )}
      </section>

      {children}

      {/* 5. History */}
      <section className={card} data-testid="lead-c-history">
        <h2 className={h2}>History</h2>
        <JobTimeline leadId={lead.id} lead={lead} />
      </section>

      {after}

      {/* Phone sticky next-step bar */}
      {stickyBar && next?.primary && (
        <div className="sticky bottom-0 z-10 -mx-1 flex gap-2 border-t border-border bg-background/95 px-1 pt-2.5 backdrop-blur md:hidden" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }} data-testid="lead-c-bar">
          {lead?.customer_phone && (
            <Button asChild variant="outline" className="h-12 px-4"><a href={`tel:${lead.customer_phone}`}><Phone className="mr-1 h-4 w-4" />Call</a></Button>
          )}
          <Button variant="brand" className="h-12 flex-1 text-base font-semibold" onClick={next.primary.onClick} disabled={next.primary.disabled}>{next.primary.label}</Button>
        </div>
      )}
    </div>
  );
}

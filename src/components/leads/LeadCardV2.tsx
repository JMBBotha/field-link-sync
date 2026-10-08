import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { laneOf, LANE_META, UNKNOWN_LANE_META } from "@/lib/leadLane";
import { hhmm, leadClock, type LeadClock, type Tone } from "@/lib/leadClock";
import { isCallDump } from "@/lib/callSummary";
import { logLeadContact, useLeadSla, useNow } from "@/hooks/useLeadSla";
import { useLaneStaff } from "@/hooks/useLaneStaff";
import CallSummary from "@/components/leads/CallSummary";

export type LeadV2 = {
  id: string; customer_name?: string | null; customer_address?: string | null; customer_phone?: string | null; phone?: string | null;
  service_type?: string | null; primary_intent?: string | null; source?: string | null; notes?: string | null; status?: string | null;
  created_at?: string | null; assigned_agent_id?: string | null; first_contact_at?: string | null; contact_attempts?: number | null;
  stage2_done_at?: string | null; sla_breached_at?: string | null; quote_sla_breached_at?: string | null;
  call_summary?: string | null; call_area?: string | null; call_urgency?: string | null; call_next_action?: string | null;
};

const TONE: Record<Tone, { text: string; bar: string; dot: string }> = {
  green: { text: "text-emerald-600", bar: "border-l-emerald-500", dot: "bg-emerald-500" },
  yellow: { text: "text-yellow-600", bar: "border-l-yellow-500", dot: "bg-yellow-500" },
  orange: { text: "text-orange-600", bar: "border-l-orange-500", dot: "bg-orange-500" },
  red: { text: "text-red-600", bar: "border-l-red-600", dot: "bg-red-600" },
  blue: { text: "text-sky-600", bar: "border-l-sky-500", dot: "bg-sky-500" },
  amber: { text: "text-amber-600", bar: "border-l-amber-500", dot: "bg-amber-500" },
  grey: { text: "text-slate-500", bar: "border-l-slate-400", dot: "bg-slate-400" },
  done: { text: "text-emerald-600", bar: "border-l-emerald-500", dot: "bg-emerald-500" },
};

export const sourceLabel = (l: Pick<LeadV2, "source" | "notes">) =>
  l.source === "vapi_call" || isCallDump(l.notes) ? "Mandy call"
    : ["website_form", "facebook_lead_ads", "google_lsa"].includes(String(l.source)) ? "Web form" : "Manual";

const waLink = (p: string) => { const d = p.replace(/\D/g, ""); return `https://wa.me/${d.startsWith("0") ? "27" + d.slice(1) : d}`; };
const initials = (n?: string | null) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Steps({ clock, lead }: { clock: LeadClock; lead: LeadV2 }) {
  const dot = (n: number, done: boolean, active: boolean) => (
    <span className={cn("grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white", done ? "bg-emerald-500" : active ? TONE[clock.tone].dot : "bg-slate-300")}>{done ? "✓" : n}</span>
  );
  return (
    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
      {dot(1, !!lead.first_contact_at, clock.stage <= 1)}
      <span>{lead.first_contact_at ? `Called ${hhmm(lead.first_contact_at)}` : "Contact"}</span>
      <span className="h-px w-4 bg-border" />
      {dot(2, clock.stage === 3, clock.stage === 2)}
      <span>{clock.stage2Label}</span>
    </div>
  );
}

type Props = {
  lead: LeadV2; onOpen?: () => void; onAssign?: () => void; assigneeName?: string | null;
  /** Replaces the assignee row (e.g. "Accept Lead" for field agents). */
  action?: ReactNode; extra?: ReactNode; className?: string;
  /** Hide phone / Call / WhatsApp (e.g. techs browsing unaccepted leads). */
  hideContact?: boolean;
  density?: "full" | "compact";
};

/** Lead card v2: lane + source tags, live two-stage clock, Call/WhatsApp (logs contact), one-line call summary, UNASSIGNED + Assign. */
export default function LeadCardV2({ lead, onOpen, onAssign, assigneeName, action, extra, className, hideContact, density = "full" }: Props) {
  const now = useNow();
  const { sla } = useLeadSla();
  const qc = useQueryClient();
  const { staff, salesStaff, technicians } = useLaneStaff();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const lane = laneOf(lead);
  const clock = leadClock(lead, now, sla);
  const phone = lead.customer_phone || lead.phone || "";
  const unassigned = !lead.assigned_agent_id;
  const compact = density === "compact";
  const who = assigneeName ?? staff.find((s) => s.id === lead.assigned_agent_id)?.full_name ?? null;
  const pool = lane === "service" ? technicians : lane === "sales" ? salesStaff : staff;
  const attempts = Number(lead.contact_attempts) || 0;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const log = async (channel: "call" | "whatsapp", outcome: "reached" | "no_answer" | "sent") => {
    setBusy(true);
    try {
      await logLeadContact(lead.id, channel, outcome);
      toast.success(outcome === "no_answer" ? "Attempt logged, the clock keeps running" : "First contact logged");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message || "Could not log the contact");
    } finally { setBusy(false); setAsking(false); }
  };
  const assign = async (id: string) => {
    const { data, error } = await supabase.from("leads").update({ assigned_agent_id: id }).eq("id", lead.id).select("id");
    if (error || !data?.length) { toast.error(error?.message || "Assign failed: no permission, or the lead changed"); return; }
    toast.success("Assigned");
    qc.invalidateQueries();
  };

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => { if (onOpen && e.key === "Enter") onOpen(); }}
      data-lead-card-v2={lead.id}
      className={cn("w-full min-w-0 space-y-2 rounded-xl border border-l-4 bg-card p-3 text-left text-card-foreground shadow-sm",
        TONE[clock?.tone ?? "grey"].bar, unassigned && clock && clock.stage < 3 && "border-dashed border-red-400", onOpen && "cursor-pointer hover:shadow-md", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide",
            lane ? LANE_META[lane].className : UNKNOWN_LANE_META.className)}>
            {lane ? LANE_META[lane].short.toUpperCase() : "LANE?"}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{sourceLabel(lead)}</span>
        </div>
        {clock && (
          <div className="shrink-0 text-right leading-tight" data-testid="lead-clock">
            <div className={cn("font-bold tabular-nums", clock.stage === 0 || clock.stage === 3 ? "text-sm" : "text-xl", TONE[clock.tone].text)}>{clock.big}</div>
            <div className="text-[10px] text-muted-foreground">{clock.sub}</div>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight">{lead.customer_name || "New lead"}</p>
        {lead.customer_address && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
            <MapPin className="mt-px h-3.5 w-3.5 shrink-0" /><span className="min-w-0 line-clamp-2 break-words">{compact ? lead.customer_address.split(",")[0] : lead.customer_address}</span>
          </p>
        )}
      </div>
      {phone && !hideContact && !compact && (
        <div className="flex flex-wrap items-center gap-1.5" onClick={stop}>
          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold tabular-nums">{phone}</span>
          <Button asChild size="sm" className="h-7 px-2.5 text-xs"><a href={`tel:${phone}`} onClick={() => setAsking(true)}>Call</a></Button>
          <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
            <a href={waLink(phone)} target="_blank" rel="noopener noreferrer" onClick={() => log("whatsapp", "sent")}>WhatsApp</a>
          </Button>
        </div>
      )}
      {asking && !compact && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/60 p-1.5 text-xs" onClick={stop}>
          <span>Did they answer?</span>
          <Button size="sm" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => log("call", "reached")}>Reached</Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => log("call", "no_answer")}>No answer</Button>
        </div>
      )}
      {!compact && <div className="flex flex-wrap gap-1" onClick={stop}>
        <CallSummary lead={lead} compact />
        {/call ?back/i.test(lead.call_next_action || "") && <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] text-red-700">Call back requested</span>}
        {attempts > 0 && !lead.first_contact_at && <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800">{attempts} attempt{attempts === 1 ? "" : "s"} · no answer</span>}
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5" onClick={stop}>
        {(!compact ? action : null) ?? (unassigned ? (
          <div className="flex items-center gap-1.5">
            <span className="rounded border border-red-500 px-1.5 py-0.5 text-[10px] font-bold text-red-600">UNASSIGNED</span>
            {!compact && (onAssign ? (
              <Button size="sm" variant="destructive" className="h-6 px-2 text-[11px]" onClick={onAssign}>Assign <ChevronDown className="ml-0.5 h-3 w-3" /></Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="destructive" className="h-6 px-2 text-[11px]">Assign <ChevronDown className="ml-0.5 h-3 w-3" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-xs">{lane === "service" ? "Technicians" : lane === "sales" ? "Sales" : "Staff"}</DropdownMenuLabel>
                  {pool.length ? pool.map((s) => <DropdownMenuItem key={s.id} onSelect={() => assign(s.id)}>{s.full_name}</DropdownMenuItem>)
                    : <DropdownMenuItem disabled>No staff found</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{initials(who)}</span>
            <span className="truncate text-xs font-medium">{who || "Assigned"}</span>
          </div>
        ))}
        {compact ? action : clock?.alerted ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">🔔 {clock.alerted}</span>
          : clock ? <Steps clock={clock} lead={lead} /> : null}
        {extra}
      </div>
    </div>
  );
}

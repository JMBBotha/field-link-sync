import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeaderCard } from "@/components/v8/ui/V8Blocks";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import AddRequestDialog from "@/components/requests/AddRequestDialog";
import RequestCorrectionsPanel from "@/components/requests/RequestCorrectionsPanel";
import { fetchInbox, markContacted, markDone, setType, typeLabel, waitLabel, REQUEST_TYPES, type RequestRow, type RequestType } from "@/lib/requests";

/** Contacted = logged contact, or server rule (manual admin add / assigned / scheduled). */
/** Same rule as fl_request_contacted (server): contacted, added by hand, assigned, has a job or is scheduled. */
export const isContacted = (r: RequestRow) =>
  r.contacted === true || !!r.first_contact_at || r.source === "manual" || !!r.assigned_to || !!r.job_id || !!r.scheduled_for;
const URL_RE = /(https?:\/\/[^\s)]*[^\s).,])/g;
/** Summary text with raw links (e.g. "Map pin: https://maps.app.goo.gl/...") shown as short tappable links. */
export function SummaryText({ text }: { text: string }) {
  const clean = text.replace(/\s*\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)/g, "").replace(/^Map pin:\s*/i, "");
  const parts = clean.split(URL_RE);
  return <>{parts.map((p, i) => /^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-[#1590D6] underline">{/maps|goo\.gl/i.test(p) ? "Open map" : "Open link"}</a>
    : <span key={i}>{p.replace(/^\.\s*$/, "")}</span>)}</>;
}
/** Where a request row opens: its job, else its lead (reps -> My jobs item, office -> visit page). */
export const requestHref = (r: RequestRow, salesRep: boolean) =>
  r.job_id ? `/admin/jobs/${r.job_id}` : r.lead_id ? (salesRep ? `/admin?myjob=${r.lead_id}` : `/admin/visits/${r.lead_id}`) : "/admin/requests";
type Filter = "open" | "sorting" | RequestType | "done" | "red" | "new" | "contacted";
const FILTER_KEYS = ["open", "sorting", "new_sale", "service", "move", "admin", "done", "red", "new", "contacted"];
const TYPE_TONE: Record<string, string> = {
  new_sale: "bg-[#E3F2FD] text-[#0D47A1]", service: "bg-[#E8F5E9] text-[#1B5E20]", move: "bg-[#F3E5F5] text-[#4A148C]", admin: "bg-[#FFF8E1] text-[#7A4F01]",
};

/** Requests inbox (Field Lynk Flow, 29 Oct): one funnel for every request, sorted by type. Tablet-first for sales/admin. */
export default function AdminRequestsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isSalesRep } = useSalesRep();
  // ?filter= deep links from the Home tiles (red "not contacted 2 h+", per type, stage).
  const [sp, setSp] = useSearchParams();
  const urlFilter = sp.get("filter");
  const [filter, setFilterState] = useState<Filter>(FILTER_KEYS.includes(urlFilter || "") ? (urlFilter as Filter) : "open");
  const setFilter = (f: Filter) => { setFilterState(f); const n = new URLSearchParams(sp); f === "open" ? n.delete("filter") : n.set("filter", f); setSp(n, { replace: true }); };
  const [assignLead, setAssignLead] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["requests-inbox"], queryFn: () => fetchInbox(30), refetchInterval: 60_000 });
  // booking time / job types / address from the lead (RLS-scoped, unmasked rows only)
  const leadIds = useMemo(() => [...new Set(data.filter((r) => !r.masked && r.lead_id).map((r) => r.lead_id!))].sort(), [data]);
  const { data: leadInfo = {} } = useQuery({
    queryKey: ["requests-lead-info", leadIds], enabled: leadIds.length > 0, staleTime: 60_000,
    queryFn: async () => {
      const { data: ls } = await supabase.from("leads").select("id, scheduled_time, service_type, job_types, job_info, customer_address").in("id", leadIds);
      return Object.fromEntries((ls || []).map((l: any) => [l.id, l])) as Record<string, any>;
    },
  });
  const withLead = (r: RequestRow): RequestRow => {
    const l = r.lead_id ? leadInfo[r.lead_id] : null;
    return l ? { ...r, scheduled_time: l.scheduled_time, service_type: l.service_type, job_types: l.job_types, job_info: l.job_info, address: l.customer_address } : r;
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["requests-inbox"] }); qc.invalidateQueries({ queryKey: ["requests-today"] }); };
  const run = async (p: Promise<{ ok: boolean; message?: string }>, okMsg: string) => {
    try { const r = await p; if (r?.ok) { toast.success(okMsg); refresh(); } else toast.error(r?.message || "Could not save"); }
    catch (e) { toast.error((e as Error).message); }
  };

  const open = data.filter((r) => r.status === "open");
  const counts = useMemo(() => ({
    open: open.length, sorting: open.filter((r) => !r.type).length, red: open.filter((r) => r.not_contacted_red).length,
    new: open.filter((r) => !isContacted(r)).length, contacted: open.filter((r) => isContacted(r)).length, done: data.filter((r) => r.status !== "open").length,
    ...Object.fromEntries(REQUEST_TYPES.map((t) => [t.v, open.filter((r) => r.type === t.v).length])),
  }) as Record<Filter, number>, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const match = (r: RequestRow) => filter === "open" ? true : filter === "sorting" ? !r.type : filter === "red" ? !!r.not_contacted_red
    : filter === "new" ? !isContacted(r) : filter === "contacted" ? isContacted(r) : r.type === filter;
  const rows = data.filter((r) => filter === "done" ? r.status !== "open" : r.status === "open" && match(r))
    .sort((a, b) => Number(!a.type) === Number(!b.type) ? Number(!!b.not_contacted_red) - Number(!!a.not_contacted_red) : Number(!b.type) - Number(!a.type));

  const chips: { k: Filter; l: string }[] = [{ k: "open", l: "All open" }, { k: "red", l: "Not contacted · 2 h+" }, { k: "new", l: "Not contacted" }, { k: "contacted", l: "Contacted" }, { k: "sorting", l: "Needs sorting" }, ...REQUEST_TYPES.map((t) => ({ k: t.v as Filter, l: t.l })), { k: "done", l: "Done" }];
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 lg:p-5" data-testid="requests-page">
      <PageHeaderCard eyebrow="Requests" title="Every request, one place" subtitle="Sort it, contact the client within 2 working hours, then assign or schedule."
        actions={<button onClick={() => setAdding(true)} data-testid="add-request" className="rounded-xl bg-[#1590D6] px-4 py-3 text-[16px] font-semibold text-white">+ Add request</button>} />
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {chips.map((c) => (
          <button key={c.k} role="tab" aria-selected={filter === c.k} onClick={() => setFilter(c.k)}
            className={cn("min-h-11 shrink-0 rounded-full border px-4 text-[14px] font-semibold", filter === c.k ? "border-[#0F2A44] bg-[#0F2A44] text-white" : "bg-card",
              c.k === "sorting" && counts.sorting > 0 && filter !== c.k && "border-[#E65100] text-[#E65100]")}>
            {c.l} <span className="opacity-70">{counts[c.k] ?? 0}</span>
          </button>
        ))}
      </div>
      <RequestCorrectionsPanel />
      {isLoading ? <div className="h-40 animate-pulse rounded-2xl bg-muted" /> : rows.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-[16px] text-muted-foreground">Nothing here. New requests land here first.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => <RequestCard key={r.id} r={withLead(r)} isAdmin={!isSalesRep} changing={changing === r.id} onChange={() => setChanging(changing === r.id ? null : r.id)}
            onType={(t) => { setChanging(null); run(setType(r.id, t), `Sorted as ${typeLabel(t)}`); }}
            onContacted={(ch) => run(markContacted(r.id, ch), "Marked contacted")}
            onAssign={() => r.lead_id ? setAssignLead(r.lead_id) : r.job_id ? navigate(`/admin/jobs/${r.job_id}`) : toast.error("Nothing to assign yet")}
            onDone={() => run(markDone(r.id), "Done")}
            onOpenClient={() => navigate(r.customer_id ? `/admin/customers/${r.customer_id}` : requestHref(r, isSalesRep))} onOpen={() => navigate(requestHref(r, isSalesRep))} />)}
        </ul>
      )}
      <LeadAssignDialog leadId={assignLead} onClose={() => { setAssignLead(null); refresh(); }} />
      <AddRequestDialog open={adding} onOpenChange={setAdding} onCreated={refresh} />
    </div>
  );
}

export { friendlyWhen } from "@/lib/friendlyWhen";
import { friendlyWhen } from "@/lib/friendlyWhen";
const mapUrl = (r: RequestRow) => r.summary?.match(/https?:\/\/[^\s)]*(maps|goo\.gl)[^\s)]*[^\s).,]/i)?.[0]
  ?? (r.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}` : null);
/** Short area: suburb from the address, else the request area. */
const METROS = /^(cape town|johannesburg|durban|pretoria|south africa|western cape|gauteng|kwazulu-natal)$/i;
export const shortArea = (r: Pick<RequestRow, "area" | "address">) => r.area || (r.address
  ? r.address.split(",").map((x) => x.trim()).filter((x, i) => i > 0 && x && !/\d/.test(x) && !METROS.test(x)).pop() ?? null : null);
const cleanSummary = (s?: string | null) => (s || "").replace(/Map pin:\s*/i, "").replace(URL_RE, "").replace(/\s*\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)/g, "").replace(/^[\s.]+|[\s.]+$/g, "");

/** One status line, plus its tone. */
export function requestStatus(r: RequestRow): { text: string; tone: "red" | "green" | "amber" | "muted" } {
  if (r.status !== "open") return { text: `Done${r.done_at ? ` · ${new Date(r.done_at).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short" })}` : ""}`, tone: "muted" };
  if (!r.type) return { text: "Needs sorting", tone: "amber" };
  if (r.type === "admin") return { text: r.task_overdue ? "Office task · overdue" : "Office task · due today", tone: r.task_overdue ? "red" : "amber" };
  const who = r.assigned_name?.trim();
  if (r.scheduled_for) return { text: ["Booked", who, friendlyWhen(r.scheduled_for, r.scheduled_time)].filter(Boolean).join(" · "), tone: "green" };
  if (!isContacted(r)) return { text: `Not contacted${r.working_min_waiting != null ? ` · ${waitLabel(r.working_min_waiting)}` : ""}`, tone: "red" };
  if (who) return { text: `With ${who} · not scheduled`, tone: r.unscheduled_nudge ? "red" : "amber" };
  return { text: `Contacted${r.contact_channel ? ` (${r.contact_channel === "whatsapp" ? "WhatsApp" : r.contact_channel})` : ""} · not scheduled`, tone: r.unscheduled_nudge ? "red" : "amber" };
}
const STATUS_TONE = { red: "text-[#C62828]", green: "text-[#1B5E20]", amber: "text-[#E65100]", muted: "text-muted-foreground" };
const waLink = (p: string) => `https://wa.me/${p.replace(/[^\d]/g, "").replace(/^0/, "27")}`;
const SEC = "inline-flex min-h-11 items-center rounded-xl border px-3 text-[14px] font-semibold";

export function RequestCard({ r, isAdmin = false, changing, onChange, onType, onContacted, onAssign, onDone, onOpenClient, onOpen }: {
  r: RequestRow; isAdmin?: boolean; changing: boolean; onChange: () => void; onType: (t: RequestType) => void; onContacted: (ch: string) => void;
  onAssign: () => void; onDone: () => void; onOpenClient: () => void; onOpen: () => void;
}) {
  const sorting = !r.type;
  const isOpen = r.status === "open";
  if (r.masked) return (
    <li className="rounded-2xl border bg-card p-3 text-[14px] text-muted-foreground" data-testid="request-masked">
      <span className={cn("mr-2 rounded-full px-2 py-0.5 text-[12px] font-semibold", r.type ? TYPE_TONE[r.type] : "bg-[#FFF3E0] text-[#E65100]")}>{typeLabel(r.type)}</span>
      Open request{r.area ? ` · ${r.area}` : ""} · details hidden (POPIA)
    </li>
  );
  const st = requestStatus(r);
  const contacted = isContacted(r);
  const map = mapUrl(r);
  const area = shortArea(r);
  const jobInfo = [r.job_types?.length ? r.job_types.join(", ") : r.service_type, cleanSummary(r.job_info || r.summary)].filter(Boolean).join(" · ");
  const canAssign = r.type !== "admin" && !!(r.lead_id || r.job_id);
  // ONE primary next step for this status
  const primary = !isOpen ? null
    : sorting ? null
    : r.type === "admin" ? { label: "Done", on: onDone, cls: "bg-[#2E7D32]", id: "request-done" }
    : !contacted ? { label: "Mark contacted", on: () => onContacted("phone"), cls: "bg-[#0F2A44]", id: "mark-contacted" }
    : canAssign && !r.scheduled_for ? { label: r.assigned_to ? "Schedule" : "Assign / schedule", on: onAssign, cls: "bg-[#1590D6]", id: "request-assign" }
    : (r.lead_id || r.job_id) ? { label: r.job_id ? "Open job" : "Open booking", on: onOpen, cls: "bg-[#1590D6]", id: "request-open" }
    : null;
  return (
    <li data-testid="request-card" data-type={r.type ?? "sorting"}
      className={cn("rounded-2xl border-2 bg-card p-3 lg:p-4", sorting && isOpen ? "border-[#E65100] bg-[#FFF8F1]" : "border-border", r.not_contacted_red && "border-l-8 border-l-[#C62828]")}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpenClient} className="min-w-0 text-left text-[18px] font-semibold leading-tight break-words">{r.customer_name || "Unknown caller"}</button>
        {sorting ? <span className="shrink-0 rounded-full bg-[#E65100] px-2.5 py-0.5 text-[12px] font-semibold text-white">Needs sorting</span>
          : <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TYPE_TONE[r.type!])}>{typeLabel(r.type)}{r.type === "move" ? " · internal" : ""}</span>}
      </div>
      <div data-testid="request-status" className={cn("mt-1 text-[15px] font-semibold", STATUS_TONE[st.tone])}>{st.text}</div>
      {(area || map) && (
        <div className="mt-0.5 text-[14px]">{area}{area && map ? " · " : ""}{map && <a href={map} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1590D6] underline">Open map</a>}</div>
      )}
      {jobInfo && <p className="mt-0.5 line-clamp-2 text-[14px] break-words" data-testid="request-summary">{jobInfo}</p>}
      {isAdmin && r.owner_rep_name && <div className="mt-0.5 text-[13px]">Client's rep: <span className="font-semibold">{r.owner_rep_name.trim()}</span></div>}
      <div className="mt-1 text-[12px] text-muted-foreground">
        {[sourceLabel(r.source), new Date(r.created_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), r.sorted_by === "auto" ? "auto-sorted" : null].filter(Boolean).join(" · ")}
      </div>
      {(sorting || changing) && isOpen && (
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="type-chips">
          {REQUEST_TYPES.map((t) => (
            <button key={t.v} onClick={() => onType(t.v)} className={cn("min-h-12 rounded-xl border-2 px-3 text-left", r.suggested_type === t.v && "border-[#1590D6]")}>
              <div className="text-[15px] font-semibold">{t.l}</div><div className="text-[12px] text-muted-foreground">{t.hint}</div>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {primary && <button onClick={primary.on} data-testid={primary.id} className={cn("min-h-11 rounded-xl px-4 text-[15px] font-semibold text-white", primary.cls)}>{primary.label}</button>}
        {r.phone && <a href={`tel:${r.phone}`} className={SEC}>Call</a>}
        {r.phone && <a href={waLink(r.phone)} target="_blank" rel="noopener noreferrer" className={SEC}>WhatsApp</a>}
        {isOpen && !sorting && (
          <details className="relative" data-testid="request-more">
            <summary className={cn(SEC, "cursor-pointer list-none")}>More</summary>
            <div className="absolute right-0 z-20 mt-1 flex w-56 flex-col rounded-xl border bg-card p-1 shadow-lg">
              {!contacted && <button onClick={() => onContacted("whatsapp")} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted" data-testid="mark-contacted-wa">Contacted on WhatsApp</button>}
              {canAssign && primary?.id !== "request-assign" && <button onClick={onAssign} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted" data-testid="request-reassign">{r.assigned_to ? "Reassign / reschedule" : "Assign / schedule"}</button>}
              {primary?.id !== "request-open" && (r.lead_id || r.job_id) && <button onClick={onOpen} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted" data-testid="request-open-sec">{r.job_id ? "Open job" : "Open booking"}</button>}
              <button onClick={onChange} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted">Change type</button>
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

const sourceLabel = (s: string) => ({ vapi_call: "Mandy call", website_form: "Website", website_shop: "Shop", facebook_lead_ads: "Facebook", google_lsa: "Google", manual: "Added by hand", job: "Job", whatsapp: "WhatsApp", phone: "Phone", email: "Email", walk_in: "Walk-in" } as Record<string, string>)[s] ?? s;

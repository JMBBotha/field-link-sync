import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeaderCard } from "@/components/v8/ui/V8Blocks";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import AddRequestDialog from "@/components/requests/AddRequestDialog";
import RequestCorrectionsPanel from "@/components/requests/RequestCorrectionsPanel";
import { fetchInbox, markContacted, markDone, setType, typeLabel, waitLabel, REQUEST_TYPES, type RequestRow, type RequestType } from "@/lib/requests";

type Filter = "open" | "sorting" | RequestType | "done";
const TYPE_TONE: Record<string, string> = {
  new_sale: "bg-[#E3F2FD] text-[#0D47A1]", service: "bg-[#E8F5E9] text-[#1B5E20]", move: "bg-[#F3E5F5] text-[#4A148C]", admin: "bg-[#FFF8E1] text-[#7A4F01]",
};

/** Requests inbox (Field Lynk Flow, 29 Oct): one funnel for every request, sorted by type. Tablet-first for sales/admin. */
export default function AdminRequestsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("open");
  const [assignLead, setAssignLead] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["requests-inbox"], queryFn: () => fetchInbox(30), refetchInterval: 60_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["requests-inbox"] }); qc.invalidateQueries({ queryKey: ["requests-today"] }); };
  const run = async (p: Promise<{ ok: boolean; message?: string }>, okMsg: string) => {
    try { const r = await p; if (r?.ok) { toast.success(okMsg); refresh(); } else toast.error(r?.message || "Could not save"); }
    catch (e) { toast.error((e as Error).message); }
  };

  const open = data.filter((r) => r.status === "open");
  const counts = useMemo(() => ({
    open: open.length, sorting: open.filter((r) => !r.type).length, done: data.filter((r) => r.status !== "open").length,
    ...Object.fromEntries(REQUEST_TYPES.map((t) => [t.v, open.filter((r) => r.type === t.v).length])),
  }) as Record<Filter, number>, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = data.filter((r) => filter === "done" ? r.status !== "open" : r.status === "open" && (filter === "open" || (filter === "sorting" ? !r.type : r.type === filter)))
    .sort((a, b) => Number(!a.type) === Number(!b.type) ? Number(!!b.not_contacted_red) - Number(!!a.not_contacted_red) : Number(!b.type) - Number(!a.type));

  const chips: { k: Filter; l: string }[] = [{ k: "open", l: "All open" }, { k: "sorting", l: "Needs sorting" }, ...REQUEST_TYPES.map((t) => ({ k: t.v as Filter, l: t.l })), { k: "done", l: "Done" }];
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
          {rows.map((r) => <RequestCard key={r.id} r={r} changing={changing === r.id} onChange={() => setChanging(changing === r.id ? null : r.id)}
            onType={(t) => { setChanging(null); run(setType(r.id, t), `Sorted as ${typeLabel(t)}`); }}
            onContacted={(ch) => run(markContacted(r.id, ch), "Marked contacted")}
            onAssign={() => r.lead_id ? setAssignLead(r.lead_id) : r.job_id ? navigate(`/admin/jobs/${r.job_id}`) : toast.error("Nothing to assign yet")}
            onDone={() => run(markDone(r.id), "Done")}
            onOpenClient={() => r.customer_id && navigate(`/admin/customers/${r.customer_id}`)} />)}
        </ul>
      )}
      <LeadAssignDialog leadId={assignLead} onClose={() => { setAssignLead(null); refresh(); }} />
      <AddRequestDialog open={adding} onOpenChange={setAdding} onCreated={refresh} />
    </div>
  );
}

function RequestCard({ r, changing, onChange, onType, onContacted, onAssign, onDone, onOpenClient }: {
  r: RequestRow; changing: boolean; onChange: () => void; onType: (t: RequestType) => void; onContacted: (ch: string) => void;
  onAssign: () => void; onDone: () => void; onOpenClient: () => void;
}) {
  const sorting = !r.type;
  const isOpen = r.status === "open";
  if (r.masked) return (
    <li className="rounded-2xl border bg-card p-3 text-[14px] text-muted-foreground" data-testid="request-masked">
      <span className={cn("mr-2 rounded-full px-2 py-0.5 text-[12px] font-semibold", r.type ? TYPE_TONE[r.type] : "bg-[#FFF3E0] text-[#E65100]")}>{typeLabel(r.type)}</span>
      Open request{r.area ? ` · ${r.area}` : ""} · details hidden (POPIA)
    </li>
  );
  return (
    <li data-testid="request-card" data-type={r.type ?? "sorting"}
      className={cn("rounded-2xl border-2 bg-card p-3 lg:p-4", sorting && isOpen ? "border-[#E65100] bg-[#FFF8F1]" : "border-border", r.not_contacted_red && "border-l-8 border-l-[#C62828]")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {sorting ? <span className="rounded-full bg-[#E65100] px-2.5 py-0.5 text-[12px] font-semibold text-white">Needs sorting{r.suggested_type ? ` · maybe ${typeLabel(r.suggested_type)}` : ""}</span>
              : <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TYPE_TONE[r.type!])}>{typeLabel(r.type)}{r.sorted_by === "auto" ? " · auto-sorted" : ""}{r.type === "move" ? " · internal sale" : ""}</span>}
            {!sorting && isOpen && <button onClick={onChange} className="text-[13px] font-semibold text-[#1590D6] underline">change</button>}
            {r.not_contacted_red && <span className="rounded-full bg-[#C62828] px-2 py-0.5 text-[12px] font-semibold text-white">Not contacted · {waitLabel(r.working_min_waiting)} working</span>}
            {r.unscheduled_nudge && <span className="rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[12px] font-semibold text-[#C62828]">Not scheduled after 24 h</span>}
            {r.task_overdue && <span className="rounded-full bg-[#FFEBEE] px-2 py-0.5 text-[12px] font-semibold text-[#C62828]">Task overdue</span>}
          </div>
          <button onClick={onOpenClient} className="mt-1 block text-left text-[18px] font-semibold">{r.customer_name || "Unknown caller"}</button>
          <div className="text-[13px] text-muted-foreground">
            {[r.area, sourceLabel(r.source), new Date(r.created_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ")}
          </div>
          {r.summary && <p className="mt-1 line-clamp-2 text-[14px]">{r.summary}</p>}
          <div className="mt-1 text-[13px] text-muted-foreground">
            {r.assigned_name ? `With ${r.assigned_name.trim()}` : r.type === "admin" ? "Office task · due today" : "Not assigned"}
            {r.scheduled_for ? ` · ${r.scheduled_for}` : ""}
            {r.type === "move" && r.owner_rep_name ? ` · client's rep ${r.owner_rep_name.trim()}` : ""}
            {r.first_contact_at ? ` · contacted (${r.contact_channel || "phone"})` : ""}
          </div>
        </div>
        {r.phone && <a href={`tel:${r.phone}`} className="min-h-11 rounded-xl border px-4 py-2 text-[15px] font-semibold">Call</a>}
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
      {isOpen && !sorting && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!r.first_contact_at && <>
            <button onClick={() => onContacted("phone")} data-testid="mark-contacted" className="min-h-11 rounded-xl bg-[#0F2A44] px-4 text-[15px] font-semibold text-white">Mark contacted</button>
            <button onClick={() => onContacted("whatsapp")} className="min-h-11 rounded-xl border px-3 text-[14px]">by WhatsApp</button>
          </>}
          {r.type === "admin" ? <button onClick={onDone} className="min-h-11 rounded-xl bg-[#2E7D32] px-4 text-[15px] font-semibold text-white">Done</button>
            : (r.lead_id || r.job_id) && <button onClick={onAssign} className="min-h-11 rounded-xl bg-[#1590D6] px-4 text-[15px] font-semibold text-white">{r.assigned_to ? "Reassign / schedule" : "Assign / schedule"}</button>}
        </div>
      )}
    </li>
  );
}

const sourceLabel = (s: string) => ({ vapi_call: "Mandy call", website_form: "Website", website_shop: "Shop", facebook_lead_ads: "Facebook", google_lsa: "Google", manual: "Added by hand", job: "Job", whatsapp: "WhatsApp", phone: "Phone", email: "Email", walk_in: "Walk-in" } as Record<string, string>)[s] ?? s;

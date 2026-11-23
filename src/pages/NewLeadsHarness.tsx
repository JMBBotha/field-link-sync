/** Signed-out sample of the red new-leads button and the Jobs list it opens. Nothing is saved. */
import { useSearchParams } from "react-router-dom";
import { Bell, Plus } from "lucide-react";
import JobsCalmView, { type CalmLead } from "@/components/jobs/calm/JobsCalmView";
import { DEFAULT_SLA, inboxTone } from "@/lib/leadClock";
import { span } from "@/lib/leadFlow";
import { laneOf } from "@/lib/leadLane";
import { newLeadsButtonTitle, newUncontactedLeads, type NewLeadRow } from "@/lib/newUncontactedLead";
import "@/components/v8/v8.css";

const NOW = new Date("2026-11-23T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** The two leads the button counts, plus rows the shared rule must leave out. */
const ROWS: NewLeadRow[] = [
  {
    id: "isanku",
    customer_name: "Isanku Logistics",
    customer_address: "3 Gulfstream Ave Airport City",
    status: "pending",
    primary_intent: "sales",
    created_at: daysAgo(3),
    assigned_agent_id: null,
    scheduled_date: null,
    first_contact_at: null,
  },
  {
    id: "munirah",
    customer_name: "Munirah Botha",
    customer_address: "12 stibitz street Westlake Business Park",
    status: "pending",
    primary_intent: "sales",
    service_type: "New Quote",
    created_at: daysAgo(5),
    assigned_agent_id: "sales-rep",
    scheduled_date: null,
    first_contact_at: null,
  },
  {
    id: "hangup",
    customer_name: "Unknown Caller",
    customer_address: "Address pending — inbound call",
    status: "pending",
    created_at: daysAgo(1),
    notes: "Call duration: 5s\nEnded reason: customer-ended-call\nAI: Thanks for calling",
  },
  {
    id: "archived",
    customer_name: "Archived lead",
    customer_address: "Old site",
    status: "pending",
    created_at: daysAgo(6),
    archived_at: daysAgo(1),
  },
];

function toCalm(l: NewLeadRow): CalmLead {
  return {
    id: l.id || "lead",
    name: l.customer_name || "New lead",
    place: (l.customer_address || "").split(",")[0]?.trim() || null,
    phone: l.customer_phone || null,
    lane: (laneOf(l) || "sales") as "sales" | "service",
    createdAt: l.created_at || null,
    contacted: false,
  };
}

export default function NewLeadsHarness() {
  const [sp] = useSearchParams();
  const phone = sp.get("frame") === "phone";
  const shown = newUncontactedLeads(ROWS);
  const tone = inboxTone(shown, NOW.getTime(), DEFAULT_SLA);
  const oldest = tone && tone.oldestMs > 0 ? `${tone.tone === "red" ? "! " : ""}oldest ${span(tone.oldestMs)}` : null;
  const leads = shown.map(toCalm);
  const jobs = (
    <JobsCalmView
      tab="today"
      onTab={() => {}}
      dateLabel="Mon 23 Nov"
      onNew={() => {}}
      leads={leads}
      leadsTotal={leads.length}
      showAllLeads
      onShowAll={() => {}}
      people={[]}
      blocks={[]}
      unassigned={[]}
      weekDays={[]}
      everyone="all"
      everyoneOptions={[{ value: "all", label: "Everyone ▾" }]}
      onEveryone={() => {}}
      chip={null}
      onChip={() => {}}
      counts={{ leadsNotContacted: leads.length, late: 0, unassigned: 0 }}
      onCallLead={() => {}}
      onAssignLead={() => {}}
      onOpenLead={() => {}}
      onAssignJob={() => {}}
      onOpenJob={() => {}}
      onOpenBlock={() => {}}
      now={NOW}
      nowMin={10 * 60}
    />
  );
  const button = (
    <div className="flex gap-1.5 px-3 pb-3">
      <button type="button" data-testid="v8-new-leads" data-tone={tone?.tone ?? "none"} className={`v8-leads flex-1 ${tone ? `tone-${tone.tone}` : "tone-blue"}`}>
        <Bell className="h-4 w-4 shrink-0" />
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span>{newLeadsButtonTitle(shown.length)}</span>
          {oldest && <span className="text-xs opacity-90">{oldest}</span>}
        </span>
      </button>
      <button type="button" className="v8-leads tone-blue w-10 justify-center px-0" aria-label="Create lead"><Plus className="h-4 w-4" /></button>
    </div>
  );
  if (phone) {
    return (
      <div data-testid="new-leads-harness" data-frame="phone" style={{ width: 390, minHeight: "100vh", background: "#F3F6FA" }}>
        {jobs}
      </div>
    );
  }
  return (
    <div data-testid="new-leads-harness" data-frame="desktop" style={{ display: "flex", height: "100vh", background: "#F3F6FA" }}>
      <aside className="v8-richer-halo flex h-full w-[232px] shrink-0 flex-col" data-testid="v8-sidebar-halo">
        <div className="v8-side flex flex-1 flex-col">
          <div className="px-3 pt-2.5">
            <div className="v8-halo-mark"><div className="v8-mark">Field Lynk</div><div className="v8-mark-sync">SYNC</div></div>
            <div className="mt-1.5 truncate text-sm font-bold">Massair CT (Pty) Ltd</div>
          </div>
          <nav className="mt-[13px] flex-1 px-2" aria-label="Main">
            <button type="button" className="v8-nav is-active" aria-current="page">Jobs</button>
          </nav>
          {button}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-auto">{jobs}</div>
    </div>
  );
}

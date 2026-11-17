import { useState } from "react";
import { startOfWeek, addDays } from "date-fns";
import V8WeekBoard, { type V8Sched } from "@/components/v8/V8WeekBoard";
import NeedsSomeoneTray from "@/components/calendar/NeedsSomeoneTray";
import BookingDetailView from "@/components/jobs/BookingDetailView";
import BookingSummaryLine from "@/components/jobs/BookingSummaryLine";
import NotificationsList from "@/components/notifications/NotificationsList";
import type { CalendarLead, CalendarSchedule } from "@/components/calendar/calendarModel";

const TECH = "tech-innocent";
const SALES = "sales-almari";
const DAY = "2026-11-19";

const people = [
  { id: TECH, full_name: "Innocent Mattienga" },
  { id: SALES, full_name: "Almari Cloete" },
];

function visit(id: string, name: string, agent: string | null): V8Sched {
  return {
    id, lead_id: id, agent_id: agent, scheduled_date: DAY, start_time: "10:00:00", end_time: "13:00:00",
    leads: { customer_name: name, service_type: "Service", status: "pending", customer_address: "Cape Town" },
  };
}

const none = visit("lead-none", "Harbour Coldroom", null);
const booked = visit("lead-tech", "Cape Glass", TECH);
const week = startOfWeek(new Date(`${DAY}T12:00:00+02:00`), { weekStartsOn: 1 });
const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
const byDate = new Map<string, V8Sched[]>([[DAY, [none, booked]]]);

const trayLead: CalendarLead = {
  id: "lead-none", customer_name: "Harbour Coldroom", customer_address: "Harbour, Cape Town",
  service_type: "Service", status: "pending", priority: "normal", assigned_agent_id: SALES,
  scheduled_date: DAY, scheduled_time: "10:00:00", primary_intent: "service",
};
const traySchedule: CalendarSchedule = {
  id: "lead-none", lead_id: "lead-none", agent_id: null, scheduled_date: DAY,
  start_time: "10:00:00", end_time: "13:00:00", notes: null, leads: trayLead,
};

/** Fixture screens for the no-technician booking. No live rows are read or written. */
export default function NoTechBookingHarness() {
  const shot = new URLSearchParams(window.location.search).get("shot");
  const [dark, setDark] = useState(shot === "dark");
  const [role, setRole] = useState<"all" | "sales" | "tech">("tech");
  const show = (id: string) => !shot || shot === id || shot === "dark" && id === "week";
  return (
    <div className={dark ? "dark bg-[#0B1626] text-[#EAF2FA]" : "bg-[#F3F6FA] text-[#0F1B2A]"} data-testid="no-tech-harness">
      <div className="space-y-4 p-4">
        <p className="rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">
          Demo harness. Sample bookings only. Nothing here is a live visit, invoice, or payment.
        </p>
        <button type="button" className="min-h-11 rounded-lg bg-[#C2410C] px-4 text-sm font-semibold text-white" onClick={() => setDark((v) => !v)}>
          {dark ? "Light mode" : "Dark mode"}
        </button>

        {show("week") && <section data-testid="harness-week" className="h-[640px] overflow-hidden rounded-xl border bg-card text-card-foreground">
          <V8WeekBoard
            days={days} month={false} byDate={byDate} people={people} staff="all" setStaff={() => {}}
            laneOf={() => "service"} winFor={() => ({ working: true, start: 8 * 60, end: 17 * 60 })}
            cancelled={0} onCancelledTray={() => {}} resched={0} onReschedTray={() => {}}
            dragOver={null} setDragOver={() => {}} onCardDragStart={() => {}} onDragEnd={() => {}} onOpen={() => {}}
            onDropDay={() => {}} onDropZone={() => {}} unscheduled={1} onTray={() => {}} sundayLabel="Sunday · on-call only"
            role={role} setRole={setRole} salesIds={new Set([SALES])} techIds={new Set([TECH])}
          />
        </section>}

        {show("month") && <section data-testid="harness-month" className="h-[420px] overflow-hidden rounded-xl border bg-card text-card-foreground">
          <V8WeekBoard
            days={days} month byDate={byDate} people={people} staff="all" setStaff={() => {}}
            laneOf={() => "service"} winFor={() => ({ working: true, start: 8 * 60, end: 17 * 60 })}
            cancelled={0} onCancelledTray={() => {}} resched={0} onReschedTray={() => {}}
            dragOver={null} setDragOver={() => {}} onCardDragStart={() => {}} onDragEnd={() => {}} onOpen={() => {}}
            onDropDay={() => {}} onDropZone={() => {}} unscheduled={1} onTray={() => {}} sundayLabel="Sunday"
            role="all" setRole={() => {}} salesIds={new Set([SALES])} techIds={new Set([TECH])}
          />
        </section>}

        {show("tray") && <section data-testid="harness-tray" className="rounded-xl border bg-card text-card-foreground">
          <NeedsSomeoneTray
            leads={[]} pool={[]} noTech={[traySchedule]}
            onLeadDragStart={() => {}} onScheduleDragStart={() => {}} onDragEnd={() => {}}
            onAssignLead={() => {}} onAssignPool={() => {}}
          />
        </section>}

        {show("detail") && <section data-testid="harness-detail" className="rounded-xl bg-card text-card-foreground">
          <BookingDetailView
            booking={{
              id: "lead-none", customer_name: "Harbour Coldroom", customer_address: "Harbour, Cape Town",
              service_type: "Service", primary_intent: "service", date: DAY, time: "10:00", end: "13:00",
              owner_name: "Almari Cloete", owner_is_sales: true, status: "pending",
              perms: { admin: true, rep: false, view: true },
            }}
            cancelOpen={false} confirmOpen={false}
            onCancelOpen={() => {}} onConfirmCancel={() => {}} onReschedule={() => {}} onOpenQuote={() => {}}
            onReassign={() => {}} onEdit={() => {}} onSetPin={() => {}} onOpenClient={() => {}} onCloseLead={() => {}}
            onReturn={() => {}} onConfirmOpen={() => {}}
          />
        </section>}

        {show("home") && <section data-testid="harness-home" className="rounded-xl border bg-card p-4 text-card-foreground">
          <h2 className="text-lg font-semibold">Jobs being done today</h2>
          <p className="text-sm text-muted-foreground">Today 2 · This week 2 · This month 2</p>
          <BookingSummaryLine input={{ kind: "Service", date: DAY, start: "10:00", end: "13:00", noTechnician: true, personName: "Almari Cloete", personRole: "sales" }} />
          <BookingSummaryLine input={{ kind: "Service", personName: "Innocent Mattienga", personRole: "technician", date: DAY, start: "10:00", end: "13:00" }} />
        </section>}

        {show("bell") && <section data-testid="harness-bell" className="max-w-md rounded-xl border bg-card text-card-foreground">
          <NotificationsList
            role="admin"
            notifications={[{
              id: "n1", type: "job_no_technician", title: "Service booked, no technician",
              body: "Harbour Coldroom · Thu 19 Nov · 10:00–13:00 · no technician",
              read: false, related_id: "lead-none", created_at: new Date().toISOString(),
              metadata: { href: "/admin/bookings/lead-none", level: "now" },
            }]}
            onMarkAsRead={() => {}} onMarkAllRead={() => {}} onClose={() => {}}
          />
        </section>}
      </div>
    </div>
  );
}

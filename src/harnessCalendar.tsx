/**
 * Fixture-only Jobs calendar. No login, no network, no live company data.
 * Open /harnessCalendar.html?tab=month|week|today
 */
import "./index.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { monthGrid } from "@/lib/jobsCalm";
import JobsCalmView, { type CalmBlock, type CalmTab } from "@/components/jobs/calm/JobsCalmView";

const q = new URLSearchParams(location.search);
const tab = (q.get("tab") || "month") as CalmTab;
const today = "2026-11-05";

const job = (over: Partial<CalmBlock>): CalmBlock => ({
  id: "job-youssin", uid: "job-youssin", kind: "job", personId: "tech-1", day: "2026-11-03",
  start: 11 * 60, dur: 120, end: 13 * 60, title: "Installation — 14 Oak Street",
  place: "14 Oak Street, Cape Town", block: "install", draggable: true, client: "Youssin Adams",
  jobType: "installation", assignee: "Innocent Mattienga", assigneeRole: "service", status: "scheduled",
  href: "/admin/jobs/job-youssin", ...over, uid: over.uid || over.id || "job-youssin",
});

const blocks: CalmBlock[] = [
  job({ id: "job-naledi", uid: "job-naledi", day: "2026-10-29", start: 14 * 60 + 5, end: 16 * 60 + 5, client: "Naledi Khumalo", title: "Installation — 29 Harbour Road", place: "29 Harbour Road, Cape Town", href: "/admin/jobs/job-naledi" }),
  job({ id: "job-youssin", uid: "job-youssin", day: "2026-11-03", start: 11 * 60, end: 13 * 60, late: true, block: "late", client: "Youssin Adams", href: "/admin/jobs/job-youssin" }),
  job({ id: "job-house32", uid: "job-house32", day: "2026-11-03", start: 15 * 60, end: 17 * 60, client: null, title: "Installation — House 32, Avec Cape Estates", place: "Avec Cape Estates, House 32", href: "/admin/jobs/job-house32" }),
  job({ id: "job-amina", uid: "job-amina", day: "2026-11-05", start: 10 * 60, end: 11 * 60, dur: 60, draggable: false, client: "Amina Patel", title: "Sales visit", place: "Sea Point, Cape Town", jobType: null, serviceType: "Sales/Consultation", block: "sales", personId: "rep-1", assignee: "Johan Botha", assigneeRole: "sales", href: "/admin/bookings/lead-amina", kind: "visit" }),
  job({ id: "job-lindiwe", uid: "job-lindiwe", day: "2026-11-06", start: 9 * 60 + 30, end: 12 * 60, client: "Lindiwe Dlamini", title: "Installation — 6 Palm Lane", place: "6 Palm Lane, Sea Point", href: "/admin/jobs/job-lindiwe" }),
  job({ id: "job-ric", uid: "job-ric", day: "2026-11-10", start: 8 * 60, end: 10 * 60, client: "Ric Meiring", title: "Repair — 8 Kloof Street", jobType: "service", block: "service", place: "8 Kloof Street, Gardens", href: "/admin/jobs/job-ric" }),
  job({ id: "job-sipho", uid: "job-sipho-1", day: "2026-11-11", start: 8 * 60, end: 16 * 60, dur: 480, client: "Sipho Nkosi", title: "Installation — 3-day run", place: "12 Beach Road, Blouberg", dayIndex: 1, dayCount: 3, href: "/admin/jobs/job-sipho" }),
  job({ id: "job-sipho", uid: "job-sipho-2", day: "2026-11-12", start: 8 * 60, end: 16 * 60, dur: 480, client: "Sipho Nkosi", title: "Installation — 3-day run", place: "12 Beach Road, Blouberg", dayIndex: 2, dayCount: 3, draggable: false, href: "/admin/jobs/job-sipho" }),
  job({ id: "job-sipho", uid: "job-sipho-3", day: "2026-11-13", start: 8 * 60, end: 16 * 60, dur: 480, client: "Sipho Nkosi", title: "Installation — 3-day run", place: "12 Beach Road, Blouberg", dayIndex: 3, dayCount: 3, draggable: false, href: "/admin/jobs/job-sipho" }),
  job({ id: "job-blank", uid: "job-blank", day: "2026-11-18", start: 9 * 60, end: null, client: null, title: "Installation", place: null, assignee: null, status: null, href: null }),
];

const from = "2026-11-02";
const weekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(`${from}T12:00:00+02:00`);
  d.setDate(d.getDate() + i);
  const day = d.toISOString().slice(0, 10);
  return { day, label: d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", timeZone: "Africa/Johannesburg" }) };
});

function App() {
  const [opened, setOpened] = useState("Click a booking to open its record");
  const [view, setView] = useState<CalmTab>(tab === "pipeline" ? "month" : tab);
  useEffect(() => {
    const id = q.get("pop");
    if (!id) return;
    const el = document.querySelector(`[data-booking-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    el?.focus();
  }, [view]);
  return (
    <div>
      <p data-fixture-banner className="bg-amber-100 px-3 py-1 text-center text-[12px] font-semibold text-amber-900">Fixture calendar — sample bookings, not live company data</p>
      <p data-opened className="bg-white px-3 py-1 text-center text-[13px] font-semibold text-[#0F2A44]">{opened}</p>
      <JobsCalmView
        tab={view} onTab={setView} dateLabel={view === "month" ? "November 2026" : "Thu 5 Nov"} onNew={() => setOpened("New job (fixture, not saved)")}
        leads={[{ id: "lead-fixture", name: "Fixture Lead", place: "Sample suburb", phone: "0000000000", lane: "service", createdAt: "2026-11-05T08:00:00+02:00", contacted: false, tag: "Fixture" }]}
        leadsTotal={1} showAllLeads={false} onShowAll={() => {}}
        people={[
          { id: "tech-1", name: "Innocent Mattienga", role: "Tech", dot: "blue" },
          { id: "rep-1", name: "Johan Botha", role: "Sales", dot: "grey" },
        ]}
        blocks={view === "today" ? blocks.filter((b) => b.day === today) : blocks}
        unassigned={[]}
        weekDays={weekDays}
        everyone="all" everyoneOptions={[{ value: "all", label: "Everyone" }]} onEveryone={() => {}}
        chip={null} onChip={() => {}} counts={{ leadsNotContacted: 1, late: 1, unassigned: 0 }}
        onCallLead={() => {}} onAssignLead={() => {}} onOpenLead={() => setOpened("Opened lead Fixture Lead")}
        onAssignJob={() => {}} onOpenJob={() => {}}
        onOpenBlock={(b) => setOpened(b.href ? `Opened ${b.href}` : "No record to open")}
        onMoveBlock={() => setOpened("Drag ignored in the fixture")}
        monthCells={monthGrid(today)} todayDay={today} onPickDay={(d) => setOpened(`Day ${d} (not a booking)`)}
        now={new Date("2026-11-05T10:30:00+02:00")}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

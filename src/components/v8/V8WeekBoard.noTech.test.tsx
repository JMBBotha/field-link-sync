import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import V8WeekBoard, { type V8Sched } from "@/components/v8/V8WeekBoard";

const days = [new Date("2026-11-19T12:00:00+02:00")];
const tech = { id: "tech-1", full_name: "Innocent Mattienga" };
const sales = { id: "sales-1", full_name: "Almari Cloete" };

function card(over: Partial<V8Sched> & { id: string }): V8Sched {
  return {
    id: over.id, lead_id: over.id, agent_id: null, scheduled_date: "2026-11-19", start_time: "10:00:00", end_time: "13:00:00",
    leads: { customer_name: "Client", service_type: "Service", status: "pending" },
    ...over,
  };
}

function board(role: "all" | "sales" | "tech", list: V8Sched[]) {
  const byDate = new Map<string, V8Sched[]>([["2026-11-19", list]]);
  return render(
    <V8WeekBoard
      days={days} month={false} byDate={byDate} people={[tech, sales]} staff="all" setStaff={() => {}}
      laneOf={() => "service"} winFor={() => ({ working: true, start: 8 * 60, end: 17 * 60 })}
      cancelled={0} onCancelledTray={() => {}} resched={0} onReschedTray={() => {}}
      dragOver={null} setDragOver={() => {}} onCardDragStart={() => {}} onDragEnd={() => {}} onOpen={() => {}}
      onDropDay={() => {}} onDropZone={() => {}} unscheduled={0} onTray={() => {}} sundayLabel="Sunday"
      role={role} setRole={() => {}} salesIds={new Set([sales.id])} techIds={new Set([tech.id])}
    />,
  );
}

describe("week board technician filter", () => {
  const rows = [
    card({ id: "none", leads: { customer_name: "No tech job", service_type: "Service", status: "pending" } }),
    card({ id: "tech", agent_id: tech.id, leads: { customer_name: "Tech job", service_type: "Service", status: "pending" } }),
  ];

  it("shows the full technician name and a no-technician chip under Technicians", () => {
    board("tech", rows);
    expect(screen.getByText("Innocent Mattienga")).toBeTruthy();
    expect(screen.getAllByTestId("no-technician").length).toBeGreaterThan(0);
    expect(screen.getByText("No tech job")).toBeTruthy();
    expect(screen.getByText("Tech job")).toBeTruthy();
  });
});

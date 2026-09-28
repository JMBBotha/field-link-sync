import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { render, fireEvent, screen } from "@testing-library/react";
import { boardLane, filterBoardRows, rowAssignee, type BoardRow } from "@/lib/jobsBoard";
import BoardChip from "@/components/jobs/BoardChip";

const J = (id: string, o: any = {}): BoardRow => ({ kind: "job", id, status: o.status ?? "scheduled", job: { id, job_type: o.type, scheduled_for: o.at, assignments: o.a ?? [] } });
const L = (id: string, o: any = {}): BoardRow => ({ kind: "lead", id, status: o.status ?? "accepted", entry: { key: id, date: o.date ?? "2026-09-28", start_time: null, lead_id: id, job_id: null, agent_id: o.agent ?? null, status: o.status ?? "accepted", customer_name: null, customer_address: null, primary_intent: o.pi ?? null, service_type: o.st ?? null } });

describe("boardLane", () => {
  it("jobs: quote/sales/consultation = sales, else service", () => {
    expect(boardLane(J("1", { type: "quote" }))).toBe("sales");
    expect(boardLane(J("2", { type: "Consultation" }))).toBe("sales");
    expect(boardLane(J("3", { type: "installation" }))).toBe("service");
    expect(boardLane(J("4", {}))).toBe("service");
  });
  it("leads: primary_intent, then service_type, else service", () => {
    expect(boardLane(L("1", { pi: "sales" }))).toBe("sales");
    expect(boardLane(L("2", { st: "Sales/Consultation" }))).toBe("sales");
    expect(boardLane(L("3", { st: "Technical/Repairs" }))).toBe("service");
    expect(boardLane(L("4"))).toBe("service");
  });
});

describe("rowAssignee", () => {
  it("contractor when participant_type is not company_staff", () => {
    const people = { p1: { full_name: "Sipho", participant_type: "independent_tech" }, p2: { full_name: "Ann", participant_type: "company_staff" } };
    expect(rowAssignee(L("1", { agent: "p1" }), people)).toEqual({ id: "p1", name: "Sipho", contractor: true });
    expect(rowAssignee(J("2", { a: [{ profile_id: "x", status: "rejected" }, { profile_id: "p2", status: "accepted", profiles: people.p2 }] }))?.id).toBe("p2");
    expect(rowAssignee(J("3"))).toBeNull();
  });
});

describe("filterBoardRows", () => {
  const rows = [
    J("j1", { status: "dispatched", type: "installation", at: "2026-09-27T22:30:00Z", a: [{ profile_id: "p1", status: "accepted" }] }),
    J("j2", { status: "cancelled", type: "quote" }),
    J("j3", { status: "on_hold" }),
    L("l1", { agent: "p2", pi: "sales", date: "2026-09-29" }),
  ];
  const ids = (f: any) => filterBoardRows(rows, f, {}, new Date("2026-09-28T10:00:00Z")).map((r) => r.id);
  it("status", () => {
    expect(ids({ status: "scheduled" })).toEqual(["j3", "l1"]);
    expect(ids({ status: "cancelled" })).toEqual(["j2"]);
  });
  it("date incl. today in Johannesburg", () => {
    expect(ids({ date: "today" })).toEqual(["j1"]);
    expect(ids({ date: "2026-09-29" })).toEqual(["l1"]);
  });
  it("assignee id and none", () => {
    expect(ids({ assignee: "p2" })).toEqual(["l1"]);
    expect(ids({ assignee: "none" })).toEqual(["j2", "j3"]);
  });
  it("lane and type", () => {
    expect(ids({ lane: "sales" })).toEqual(["j2", "l1"]);
    expect(ids({ type: "installation" })).toEqual(["j1"]);
  });
});

describe("chip clicks", () => {
  it("apply the filter without opening the card", () => {
    const open = vi.fn(); const select = vi.fn();
    render(<div role="link" onClick={open} onKeyDown={open}><BoardChip label="Filter Sales" onSelect={select}>Sales</BoardChip></div>);
    fireEvent.click(screen.getByLabelText("Filter Sales"));
    fireEvent.keyDown(screen.getByLabelText("Filter Sales"), { key: "Enter" });
    expect(select).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});

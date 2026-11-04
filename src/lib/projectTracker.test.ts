import { describe, it, expect } from "vitest";
import { houseStatus, houseReminders, moneyByHouse, DEFAULT_STEPS, phaseFor, sortHouses, type ProjectStep } from "./projectTracker";

const st = (k: string, done: boolean): ProjectStep => ({ id: k, step_key: k, label: k, rate: 0, sort_order: 0, done, paid: false });
const all = (d: [boolean, boolean, boolean]) => [st("piping", d[0]), st("units", d[1]), st("commissioning", d[2])];

const four = (d: [boolean, boolean, boolean, boolean]) => [st("first_fit", d[0]), ...all([d[1], d[2], d[3]])];
const inv = (sent: string | null, total = 100, paid = 0) => ({ invoiced: total, paid, invoiceCount: 1, invoiceNumbers: ["INV-T1"], invoices: [{ id: "i1", number: "INV-T1", total, paid, sent_at: sent }] });
const H = (steps: ProjectStep[]) => ({ steps, status_override: null });
const NOW = new Date("2026-12-01T10:00:00Z");

describe("houseStatus (billing flow)", () => {
  it("grey when nothing started", () => expect(houseStatus(H(four([false, false, false, false])))).toBe("not_started"));
  it("first fit ticked -> first fit done (orange)", () => expect(houseStatus(H(four([true, false, false, false])))).toBe("in_progress"));
  it("draft (unsent) invoice stays at first fit", () => expect(houseStatus(H(four([true, false, false, false])), inv(null))).toBe("in_progress"));
  it("invoice sent -> invoiced, 50% due (red)", () => expect(houseStatus(H(four([true, true, false, false])), inv("2026-10-01T08:00:00Z"))).toBe("due"));
  it("units in -> final 50% due (same invoice)", () => expect(houseStatus(H(four([true, true, true, false])), inv("2026-10-01T08:00:00Z", 100, 50))).toBe("units_in"));
  it("green only when the full invoice is paid", () => {
    expect(houseStatus(H(four([true, true, true, true])), inv("2026-10-01T08:00:00Z", 100, 99))).toBe("units_in");
    expect(houseStatus(H(four([true, true, true, true])), inv("2026-10-01T08:00:00Z", 100, 100))).toBe("done");
  });
  it("no invoice is never green", () => expect(houseStatus(H(four([true, true, true, true])))).toBe("units_in"));
  it("override wins", () => expect(houseStatus({ steps: [], status_override: "done" })).toBe("done"));
});

describe("houseReminders (in-app only)", () => {
  it("first fit -> send estimate to get PO", () => expect(houseReminders(H(four([true, false, false, false])), undefined, NOW)[0].text).toBe("Send estimate to get PO number"));
  it("no reminder before 30 days", () => expect(houseReminders(H(four([true, false, false, false])), inv("2026-11-10T08:00:00Z"), NOW)).toEqual([]));
  it("30-day check", () => expect(houseReminders(H(four([true, false, false, false])), inv("2026-10-25T08:00:00Z"), NOW)[0].text).toMatch(/ready for units \(30-day/));
  it("60-day check", () => expect(houseReminders(H(four([true, false, false, false])), inv("2026-09-20T08:00:00Z"), NOW)[0].text).toMatch(/60-day/));
  it("units in -> final 50% due on the same invoice", () => expect(houseReminders(H(four([true, true, true, false])), inv("2026-09-20T08:00:00Z", 100, 50), NOW)[0].text).toBe("Final 50% due on INV-T1"));
});

describe("default steps", () => {
  it("start with first fit and carry no fixed labour rates", () => { expect(DEFAULT_STEPS[0].step_key).toBe("first_fit"); expect(DEFAULT_STEPS.every((s) => s.rate === 0)).toBe(true); });
});

describe("moneyByHouse", () => {
  it("sums invoices and completed payments, skips void/archived/unlinked", () => {
    const m = moneyByHouse(
      [{ id: "a", project_house_id: "h1", grand_total: 100, status: "sent", invoice_number: "1" },
       { id: "b", project_house_id: "h1", grand_total: 50, status: "void", invoice_number: "2" },
       { id: "c", project_house_id: null, grand_total: 70, status: "sent", invoice_number: "3" },
       { id: "d", project_house_id: "h1", grand_total: 30, status: "sent", invoice_number: "4", archived_at: "x" }],
      [{ invoice_id: "a", amount: 40, status: "completed" }, { invoice_id: "a", amount: 10, status: "failed" }]);
    expect(m.h1).toMatchObject({ invoiced: 100, paid: 40, invoiceCount: 1, invoiceNumbers: ["1"] });
    expect(m.h1.invoices?.[0]).toMatchObject({ id: "a", number: "1", paid: 40 });
  });
});

describe("phases", () => {
  const phases = [{ id: "p1", name: "P1", house_from: 1, house_to: 30, sort_order: 1 }, { id: "p4", name: "P4", house_from: 91, house_to: null, sort_order: 4 }];
  it("range lookup and open-ended", () => { expect(phaseFor({ phase_id: null, house_no: "12" }, phases)).toBe("p1"); expect(phaseFor({ phase_id: null, house_no: "94" }, phases)).toBe("p4"); expect(phaseFor({ phase_id: null, house_no: "50" }, phases)).toBeNull(); });
  it("sorts numerically", () => expect(sortHouses([{ house_no: "10" }, { house_no: "2" }, { house_no: "2A" }]).map((h) => h.house_no)).toEqual(["2", "2A", "10"]));
});

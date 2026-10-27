import { describe, it, expect } from "vitest";
import { houseStatus, moneyByHouse, phaseFor, sortHouses, type ProjectStep } from "./projectTracker";

const st = (k: string, done: boolean): ProjectStep => ({ id: k, step_key: k, label: k, rate: 0, sort_order: 0, done, paid: false });
const all = (d: [boolean, boolean, boolean]) => [st("piping", d[0]), st("units", d[1]), st("commissioning", d[2])];

describe("houseStatus", () => {
  it("grey when nothing started", () => expect(houseStatus({ steps: all([false, false, false]), ready_for_aircon: false, status_override: null })).toBe("not_started"));
  it("orange when a step is done", () => expect(houseStatus({ steps: all([true, false, false]), ready_for_aircon: false, status_override: null })).toBe("in_progress"));
  it("red when ticked ready and units not installed", () => expect(houseStatus({ steps: all([true, false, false]), ready_for_aircon: true, status_override: null })).toBe("due"));
  it("not red once units are in", () => expect(houseStatus({ steps: all([true, true, false]), ready_for_aircon: true, status_override: null })).toBe("in_progress"));
  it("all done but unpaid stays orange", () => expect(houseStatus({ steps: all([true, true, true]), ready_for_aircon: false, status_override: null }, { invoiced: 100, paid: 50, invoiceCount: 1, invoiceNumbers: [] })).toBe("in_progress"));
  it("all done and paid is green", () => expect(houseStatus({ steps: all([true, true, true]), ready_for_aircon: false, status_override: null }, { invoiced: 100, paid: 100, invoiceCount: 1, invoiceNumbers: [] })).toBe("done"));
  it("all done with no invoice is not green", () => expect(houseStatus({ steps: all([true, true, true]), ready_for_aircon: false, status_override: null })).toBe("in_progress"));
  it("override wins", () => expect(houseStatus({ steps: all([false, false, false]), ready_for_aircon: false, status_override: "done" })).toBe("done"));
});

describe("moneyByHouse", () => {
  it("sums invoices and completed payments, skips void/archived/unlinked", () => {
    const m = moneyByHouse(
      [{ id: "a", project_house_id: "h1", grand_total: 100, status: "sent", invoice_number: "1" },
       { id: "b", project_house_id: "h1", grand_total: 50, status: "void", invoice_number: "2" },
       { id: "c", project_house_id: null, grand_total: 70, status: "sent", invoice_number: "3" },
       { id: "d", project_house_id: "h1", grand_total: 30, status: "sent", invoice_number: "4", archived_at: "x" }],
      [{ invoice_id: "a", amount: 40, status: "completed" }, { invoice_id: "a", amount: 10, status: "failed" }]);
    expect(m.h1).toEqual({ invoiced: 100, paid: 40, invoiceCount: 1, invoiceNumbers: ["1"] });
  });
});

describe("phases", () => {
  const phases = [{ id: "p1", name: "P1", house_from: 1, house_to: 30, sort_order: 1 }, { id: "p4", name: "P4", house_from: 91, house_to: null, sort_order: 4 }];
  it("range lookup and open-ended", () => { expect(phaseFor({ phase_id: null, house_no: "12" }, phases)).toBe("p1"); expect(phaseFor({ phase_id: null, house_no: "94" }, phases)).toBe("p4"); expect(phaseFor({ phase_id: null, house_no: "50" }, phases)).toBeNull(); });
  it("sorts numerically", () => expect(sortHouses([{ house_no: "10" }, { house_no: "2" }, { house_no: "2A" }]).map((h) => h.house_no)).toEqual(["2", "2A", "10"]));
});

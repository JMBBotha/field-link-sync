import { describe, it, expect } from "vitest";
import { houseStatus, houseReminders, moneyByHouse, photosByHouse, DEFAULT_STEPS, phaseFor, sortHouses, showNoInvoice, stageLabel, type ProjectStep, type HouseMoney } from "./projectTracker";

const st = (k: string, done: boolean): ProjectStep => ({ id: k, step_key: k, label: k, rate: 0, sort_order: 0, done, paid: false });
const all = (d: [boolean, boolean, boolean]) => [st("piping", d[0]), st("units", d[1]), st("commissioning", d[2])];

const four = (d: [boolean, boolean, boolean, boolean]) => [st("first_fit", d[0]), ...all([d[1], d[2], d[3]])];
const inv = (sent: string | null, total = 100, paid = 0): HouseMoney => ({ invoiced: total, paid, invoiceCount: 1, invoiceNumbers: ["INV-T1"], invoices: [{ id: "i1", number: "INV-T1", total, paid, sent_at: sent }] });
const H = (steps: ProjectStep[]) => ({ steps, status_override: null });
const NOW = new Date("2026-12-01T10:00:00Z");

describe("houseStatus (billing flow)", () => {
  it("grey when nothing started", () => expect(houseStatus(H(four([false, false, false, false])))).toBe("not_started"));
  it("first fit ticked -> first fit done (orange)", () => expect(houseStatus(H(four([true, false, false, false])))).toBe("in_progress"));
  it("draft (unsent) invoice stays at first fit", () => expect(houseStatus(H(four([true, false, false, false])), inv(null))).toBe("in_progress"));
  it("invoice sent -> first half (red), even when units are in", () => {
    expect(houseStatus(H(four([true, true, false, false])), inv("2026-10-01T08:00:00Z"))).toBe("due");
    expect(houseStatus(H(four([true, true, true, false])), inv("2026-10-01T08:00:00Z", 100, 50))).toBe("due");
  });
  it("final half only once commissioning is done and the balance is unpaid", () => {
    expect(houseStatus(H(four([true, true, true, true])), inv("2026-10-01T08:00:00Z", 100, 50))).toBe("units_in");
    expect(houseStatus(H(four([true, true, true, false])))).toBe("in_progress");
  });
  it("green only when the full invoice is paid", () => {
    expect(houseStatus(H(four([true, true, true, true])), inv("2026-10-01T08:00:00Z", 100, 99))).toBe("units_in");
    expect(houseStatus(H(four([true, true, true, true])), inv("2026-10-01T08:00:00Z", 100, 100))).toBe("done");
  });
  it("no invoice is never green", () => expect(houseStatus(H(four([true, true, true, true])))).toBe("units_in"));
  it("override wins", () => expect(houseStatus({ steps: [], status_override: "done" })).toBe("done"));
  it("names what is owed", () => {
    expect(stageLabel("due", inv("2026-10-01T08:00:00Z", 100, 0))).toBe("Deposit 50% unpaid · invoice sent");
    expect(stageLabel("due", inv("2026-10-01T08:00:00Z", 100, 50))).toBe("Deposit paid · balance due when the job is finished");
    expect(stageLabel("units_in", inv("2026-10-01T08:00:00Z", 100, 50))).toBe("Job complete · final 50% unpaid");
  });
});

describe("houseReminders (in-app only)", () => {
  it("first fit -> send estimate to get PO", () => expect(houseReminders(H(four([true, false, false, false])), undefined, NOW)[0].text).toBe("Send estimate to get PO number"));
  it("no reminder before 30 days", () => expect(houseReminders(H(four([true, false, false, false])), inv("2026-11-10T08:00:00Z"), NOW)).toEqual([]));
  it("30-day check", () => expect(houseReminders(H(four([true, false, false, false])), inv("2026-10-25T08:00:00Z"), NOW)[0].text).toMatch(/ready for units \(30-day/));
  it("60-day check", () => expect(houseReminders(H(four([true, false, false, false])), inv("2026-09-20T08:00:00Z"), NOW)[0].text).toMatch(/60-day/));
  it("units in but the job still open does not ask for the final half", () => {
    const r = houseReminders(H(four([true, true, true, false])), inv("2026-09-20T08:00:00Z", 100, 50), NOW);
    expect(r.some((x) => x.kind === "final_due")).toBe(false);
  });
  it("job complete -> final half unpaid, with a stored expected date", () => {
    const money = inv("2026-09-20T08:00:00Z", 100, 50);
    money.invoices![0].expected_final_date = "2026-12-15";
    expect(houseReminders(H(four([true, true, true, true])), money, NOW)[0].text).toBe("Final 50% still unpaid · job is complete on INV-T1 · expected 15 Dec 2026");
  });
  it("omits the date when none was stored, and ignores an automatic due date", () => {
    const auto = inv("2026-09-20T08:00:00Z", 100, 50);
    auto.invoices![0].due_date = "2026-10-12";
    expect(houseReminders(H(four([true, true, true, true])), auto, NOW)[0].text).toBe("Final 50% still unpaid · job is complete on INV-T1");
    const manual = inv("2026-09-20T08:00:00Z", 100, 50);
    manual.invoices![0].due_date = "2026-12-01";
    manual.invoices![0].due_date_source = "manual";
    expect(houseReminders(H(four([true, true, true, true])), manual, NOW)[0].text).toContain("expected 1 Dec 2026");
  });
  it("done & paid, including a paid override with no invoice, raises no reminder and hides no-invoice", () => {
    const paidOutside = { steps: four([true, true, true, true]), status_override: "done" as const };
    expect(houseStatus(paidOutside)).toBe("done");
    expect(houseReminders(paidOutside, undefined, NOW)).toEqual([]);
    expect(showNoInvoice("done", undefined)).toBe(false);
    expect(showNoInvoice("not_started", undefined)).toBe(true);
    const money = inv("2026-10-01T08:00:00Z", 100, 100);
    expect(houseReminders(H(four([true, true, true, true])), money, NOW)).toEqual([]);
  });
  it("puts a stored deposit date on the first-half chip", () => {
    const money = inv("2026-11-10T08:00:00Z", 100, 0);
    money.invoices![0].expected_deposit_date = "2026-11-20";
    expect(stageLabel("due", money)).toBe("Deposit 50% unpaid · invoice sent · expected 20 Nov 2026");
  });
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

describe("photosByHouse", () => {
  it("counts job photos via invoice -> job (invoice_id or lead) and skips unlinked", () => {
    const r = photosByHouse(
      [{ id: "i1", project_house_id: "h1", lead_id: "L1" }, { id: "i2", project_house_id: null, lead_id: "L9" }],
      [{ id: "j1", title: "Install", invoice_id: "i1", lead_id: "L1" }, { id: "j2", title: "Commission", invoice_id: null, lead_id: "L1" }, { id: "j9", title: "Other", invoice_id: "i2", lead_id: "L9" }],
      [{ lead_id: "L1" }, { lead_id: "L1" }, { lead_id: "L9" }]);
    expect(r.h1.jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
    expect(r.h1.count).toBe(4);
    expect(Object.keys(r)).toEqual(["h1"]);
  });
});

import { docsByHouse } from "./projectTracker";
describe("docsByHouse", () => {
  const doc = (id: string, path: string | null) => ({ id, doc_type: "delivery_note", doc_number: id, supplier_name: "Acme", doc_date: "2026-01-02", storage_path: path });
  it("groups confirmed links by the house's jobs, one entry per doc", () => {
    const photos = { h1: { count: 0, jobs: [{ id: "j1", title: "A", count: 0 }, { id: "j2", title: "B", count: 0 }] }, h2: { count: 0, jobs: [{ id: "j3", title: "C", count: 0 }] } };
    const out = docsByHouse(photos, [
      { job_id: "j1", status: "confirmed", doc: doc("D1", "x.pdf") },
      { job_id: "j2", status: "confirmed", doc: doc("D1", "x.pdf") },
      { job_id: "j2", status: "suggested", doc: doc("D2", null) },
      { job_id: "j9", status: "confirmed", doc: doc("D3", null) },
    ]);
    expect(out.h1.count).toBe(1);
    expect(out.h1.docs[0].jobIds).toEqual(["j1", "j2"]);
    expect(out.h2).toBeUndefined();
  });
});

import { namesHouse, directJobsByHouse } from "./projectTracker";
describe("direct house -> job", () => {
  it("matches whole house numbers only", () => {
    expect(namesHouse("Installation — Avec Cape Estates House 32", "32")).toBe(true);
    expect(namesHouse("Installation — Avec Cape Estates House 32", "3")).toBe(false);
    expect(namesHouse("House 132", "32")).toBe(false);
    expect(namesHouse("house no. 7 and House #8", "8")).toBe(true);
    expect(namesHouse("project house 2dfbcf8f", "2")).toBe(false);
  });
  const houses = [{ id: "h3", house_no: "3" }, { id: "h32", house_no: "32" }, { id: "h88", house_no: "88" }];
  const jobs = [
    { id: "j32", title: "Installation — Avec Cape Estates House 32", description: "House 32 (project house cc784a1b). No invoice", customer_id: "c1", lead_id: "L32", invoice_id: null },
    { id: "j88", title: "Installation — Avec Cape Estates House 88", description: "House 88. Invoice 0010006", customer_id: "c1", lead_id: "L88", invoice_id: "i88" },
    { id: "jx", title: "Avec House 32", description: null, customer_id: "OTHER", lead_id: null, invoice_id: null },
    { id: "jd", title: "Service call", description: "Leak at house 3", customer_id: "c1", lead_id: null, invoice_id: null },
  ];
  it("same client only, title first, description fallback", () => {
    const d = directJobsByHouse(houses, jobs, "c1");
    expect(d.h32.map((j) => j.id)).toEqual(["j32"]);
    expect(d.h88.map((j) => j.id)).toEqual(["j88"]);
    expect(d.h3.map((j) => j.id)).toEqual(["jd"]);
  });
  it("un-invoiced house gets its job + photos; invoice + direct are deduped", () => {
    const d = directJobsByHouse(houses, jobs, "c1");
    const out = photosByHouse([{ id: "i88", project_house_id: "h88", lead_id: null }], [jobs[1]], [{ lead_id: "L32" }, { lead_id: "L32" }, { lead_id: "L88" }], d);
    expect(out.h32).toEqual({ count: 2, jobs: [{ id: "j32", title: jobs[0].title, count: 2 }] });
    expect(out.h88.jobs.length).toBe(1);
    expect(out.h88.count).toBe(1);
  });
});

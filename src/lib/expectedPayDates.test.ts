import { describe, expect, it } from "vitest";
import { projectExpected } from "./expectedMoney";
import {
  STELLENBOSCH_PROJECT_ID,
  computeExpectedLines,
  isLate,
  payExpectSettings,
  projectDateOn,
  toAutoExpected,
  usesProjectTiming,
  type ExpectHouse,
  type ExpectInvoice,
  type ExpectJob,
  type ProjectExpectOverride,
} from "./expectedPayDates";

const company = "co";
const avec = "proj-avec";
const village = STELLENBOSCH_PROJECT_ID;
const cottage = "proj-cottage";
const houses: ExpectHouse[] = [
  { id: "a1", projectId: avec, houseNo: "12" },
  { id: "a2", projectId: avec, houseNo: "13" },
  { id: "s1", projectId: village, houseNo: "4" },
  { id: "s2", projectId: village, houseNo: "5" },
  { id: "c1", projectId: cottage, houseNo: "1" },
];
const projects = [
  { id: avec, customerId: "cust-avec" },
  { id: village, customerId: "cust-village" },
  { id: cottage, customerId: "cust-cottage" },
];
const seeds: ProjectExpectOverride[] = [
  { projectId: avec, timing: "project", dateMode: "month_end", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: null, monthOffset: 0 },
  { projectId: village, timing: "project", dateMode: "day_of_month", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: 15, monthOffset: 1 },
];

function inv(over: Partial<ExpectInvoice> & { id: string }): ExpectInvoice {
  return {
    companyId: company,
    status: "sent",
    notes: "Final",
    issueDate: "2026-11-16",
    sentAt: "2026-11-16",
    balance: 1000,
    part: "final",
    customerName: "Client",
    invoiceNumber: over.id,
    ...over,
  };
}

function lines(extra?: { invoices?: ExpectInvoice[]; jobs?: ExpectJob[]; overrides?: ProjectExpectOverride[]; quotes?: Parameters<typeof computeExpectedLines>[0]["context"] extends infer C ? C extends { quotes?: infer Q } ? Q : never : never }) {
  return computeExpectedLines({
    companyId: company,
    invoices: extra?.invoices || [],
    context: {
      settings: payExpectSettings(null),
      houses,
      projects,
      projectOverrides: extra?.overrides || seeds,
      invoiceOverrides: [],
      jobs: extra?.jobs || [],
      quotes: extra?.quotes || [],
      defaultDepositPct: 50,
    },
  });
}

describe("expected payment dates", () => {
  it("uses project timing only when a developer project has more than one house", () => {
    expect(usesProjectTiming(2, null)).toBe(true);
    expect(usesProjectTiming(1, null)).toBe(false);
    expect(usesProjectTiming(0, null)).toBe(false);
    expect(usesProjectTiming(1, "project")).toBe(true);
    expect(usesProjectTiming(8, "normal")).toBe(false);
  });

  it("shifts a fixed day and the month end by the invoice month offset", () => {
    expect(projectDateOn("2026-11-15", "day_of_month", { days: 15, dayOfMonth: 15, monthOffset: 1 })).toBe("2026-12-15");
    expect(projectDateOn("2026-11-16", "month_end", { days: 15, dayOfMonth: 1, monthOffset: 0 })).toBe("2026-11-30");
    expect(projectDateOn("2026-11-16", "days_after", { days: 15, dayOfMonth: 1, monthOffset: 0 })).toBe("2026-12-01");
    expect(projectDateOn("2026-01-31", "day_of_month", { days: 0, dayOfMonth: 31, monthOffset: 1 })).toBe("2026-02-28");
    expect(projectDateOn("2024-01-15", "day_of_month", { days: 0, dayOfMonth: 31, monthOffset: 1 })).toBe("2024-02-29");
  });

  it("shows a project deposit and final on the seeded rules, and the default 15 to 20 day window", () => {
    const found = lines({
      invoices: [
        inv({ id: "sv-d", part: "deposit", notes: "DEPOSIT", projectHouseId: "s1", customerName: "Stellenbosch Village", invoiceNumber: "SV-D", balance: 15000, issueDate: "2026-11-15" }),
        inv({ id: "sv-f", part: "final", projectHouseId: "s2", customerName: "Stellenbosch Village", invoiceNumber: "SV-F", balance: 15000, issueDate: "2026-11-15" }),
        inv({ id: "av-d", part: "deposit", notes: "DEPOSIT", projectHouseId: "a1", customerName: "AVEC", invoiceNumber: "AV-D", balance: 8000, issueDate: "2026-11-16" }),
        inv({ id: "av-f", part: "final", projectHouseId: "a2", customerName: "AVEC", invoiceNumber: "AV-F", balance: 4200, issueDate: "2026-11-16" }),
        inv({ id: "es-d", part: "deposit", notes: "DEPOSIT", customerName: "Harbour Estate", invoiceNumber: "ES-D", balance: 9000, issueDate: "2026-11-16", projectHouseId: "extra" }),
      ],
    });
    // Harbour Estate has no house in the list, so the unknown house does not make it a project.
    const estate = found.find((row) => row.invoiceId === "es-d");
    expect(estate?.timing).toBe("normal");
    const multi = lines({
      invoices: [
        inv({ id: "sv-d", part: "deposit", notes: "DEPOSIT", projectHouseId: "s1", balance: 15000, issueDate: "2026-11-15" }),
        inv({ id: "av-d", part: "deposit", notes: "DEPOSIT", projectHouseId: "a1", balance: 8000 }),
        inv({ id: "def-d", part: "deposit", notes: "DEPOSIT", projectHouseId: "h-many", balance: 9000, issueDate: "2026-11-16" }),
      ],
      overrides: [
        ...seeds,
        { projectId: "proj-many", timing: null, dateMode: null, depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: null, monthOffset: null },
      ],
    });
    expect(multi.find((row) => row.invoiceId === "sv-d")).toMatchObject({ date: "2026-12-15", display: "Expected 15 Dec", dateMode: "day_of_month" });
    expect(multi.find((row) => row.invoiceId === "av-d")).toMatchObject({ date: "2026-11-30", display: "Expected 30 Nov", dateMode: "month_end" });
  });

  it("uses the 15 to 20 day window for a multi-house project left on days after the invoice", () => {
    const many: ExpectHouse[] = [...houses, { id: "m1", projectId: "proj-many", houseNo: "1" }, { id: "m2", projectId: "proj-many", houseNo: "2" }];
    const found = computeExpectedLines({
      companyId: company,
      invoices: [
        inv({ id: "d", part: "deposit", notes: "DEPOSIT", projectHouseId: "m1", balance: 9000, issueDate: "2026-11-16" }),
        inv({ id: "f", part: "final", projectHouseId: "m2", balance: 4000, issueDate: "2026-11-20" }),
      ],
      context: { houses: many, projects: [...projects, { id: "proj-many", customerId: "cust" }], settings: payExpectSettings(null), projectOverrides: [], invoiceOverrides: [], jobs: [], quotes: [], defaultDepositPct: 50 },
    });
    expect(found.find((row) => row.invoiceId === "d")).toMatchObject({ date: "2026-12-01", windowEnd: "2026-12-06", display: "Expected 1 Dec (1 to 6 Dec)" });
    expect(found.find((row) => row.invoiceId === "f")?.display).toBe("Expected 5 Dec (5 to 10 Dec)");
  });

  it("counts a normal job from the invoice, the completion, or the quote acceptance", () => {
    const found = lines({
      invoices: [
        inv({ id: "nd", part: "deposit", notes: "DEPOSIT", balance: 3000, issueDate: "2026-11-16", quoteId: "q-has" }),
        inv({ id: "done", part: "final", balance: 7000, issueDate: "2026-11-01", quoteId: "q-done" }),
        inv({ id: "open", part: "final", balance: 2000, issueDate: "2026-11-16", quoteId: "q-open" }),
        inv({ id: "paid", status: "paid", part: "deposit", notes: "DEPOSIT", balance: 500, quoteId: "q-paid" }),
        inv({ id: "void", status: "void", balance: 500 }),
        inv({ id: "gone", archivedAt: "2026-11-01", balance: 500 }),
        inv({ id: "part", part: "deposit", notes: "DEPOSIT", balance: 400, projectHouseId: "a1" }),
      ],
      jobs: [
        { id: "j-done", quoteId: "q-done", completedAt: "2026-11-09T15:00:00+02:00" },
        { id: "j-open", quoteId: "q-open", completedAt: null },
      ],
      quotes: [
        { id: "q-new", companyId: company, status: "accepted", acceptedAt: "2026-11-13T10:00:00+02:00", total: 20000, customerName: "Harbour", quoteNumber: "Q-9", paymentPlan: { name: "50/50", stages: [{ pct: 50 }, { pct: 50 }] } },
        { id: "q-has", companyId: company, status: "accepted", acceptedAt: "2026-11-01", total: 99999, quoteNumber: "Q-HAS" },
        { id: "q-house", companyId: company, status: "accepted", acceptedAt: "2026-11-13", total: 10000, customerId: "cust-avec", quoteNumber: "Q-H" },
      ],
    });
    expect(found.find((row) => row.invoiceId === "nd")).toMatchObject({ date: "2026-11-19", timing: "normal", display: "Expected 19 Nov" });
    expect(found.find((row) => row.invoiceId === "done")).toMatchObject({ date: "2026-11-16", estimate: false });
    expect(found.find((row) => row.invoiceId === "open")).toMatchObject({ date: "2026-11-23", estimate: true, display: "Expected 23 Nov · estimate" });
    expect(found.some((row) => row.invoiceId === "paid" || row.invoiceId === "void" || row.invoiceId === "gone")).toBe(false);
    expect(found.find((row) => row.invoiceId === "part")?.amount).toBe(400);
    expect(found.find((row) => row.quoteId === "q-new")).toMatchObject({ amount: 10000, date: "2026-11-16", source: "acceptance" });
    expect(found.some((row) => row.quoteId === "q-has" && row.source === "acceptance")).toBe(false);
    const named = lines({
      invoices: [],
      quotes: [{ id: "q-house", companyId: company, status: "accepted", acceptedAt: "2026-11-13", total: 10000, customerId: "cust-avec", quoteNumber: "Q-H" }],
      jobs: [{ id: "j-h", quoteId: "q-house", customerId: "cust-avec", title: "Installation — AVEC House 12" }],
    });
    expect(named.some((row) => row.source === "acceptance")).toBe(false);
  });

  it("lets a single house stay normal until an admin forces the project rule, and an invoice date wins", () => {
    const cottageInv = inv({ id: "cot", part: "deposit", notes: "DEPOSIT", projectHouseId: "c1", issueDate: "2026-11-16", balance: 2500 });
    const auto = lines({ invoices: [cottageInv], overrides: [] });
    expect(auto[0]).toMatchObject({ timing: "normal", date: "2026-11-19" });
    const forced = lines({
      invoices: [cottageInv],
      overrides: [{ projectId: cottage, timing: "project", dateMode: "days_after", depositDays: 15, finalDays: 15, windowExtraDays: 5, dayOfMonth: null, monthOffset: null }],
    });
    expect(forced[0]).toMatchObject({ timing: "project", date: "2026-12-01", display: "Expected 1 Dec (1 to 6 Dec)" });
    const pinned = computeExpectedLines({
      companyId: company,
      invoices: [cottageInv],
      context: {
        houses, projects, settings: payExpectSettings(null), jobs: [], quotes: [], defaultDepositPct: 50, projectOverrides: [],
        invoiceOverrides: [{ invoiceId: "cot", part: "deposit", expectedOn: "2026-12-25" }],
      },
    });
    expect(pinned[0]).toMatchObject({ date: "2026-12-25", source: "override", display: "Expected 25 Dec", estimate: false });
  });

  it("reads Late only after the grace, and a WALDA row replaces the computed invoice", () => {
    expect(isLate("2026-11-04", "2026-11-16", 3)).toBe(true);
    expect(isLate("2026-11-14", "2026-11-16", 3)).toBe(false);
    const auto = toAutoExpected(lines({
      invoices: [inv({ id: "late", part: "deposit", notes: "DEPOSIT", issueDate: "2026-11-01", balance: 3000 })],
    }));
    const picture = projectExpected({
      today: "2026-11-16",
      cash: 0,
      auto,
      lateGraceDays: 3,
      manual: [{ id: "w", source: "walda", part: "deposit", invoiceId: "sv", quoteId: null, amount: 10, date: "2026-12-01", label: "Village", note: null }],
    });
    expect(picture.rows.find((row) => row.id === "inv:late:deposit")?.dateLabel).toMatch(/^Late · Expected 4 Nov/);
    const replaced = projectExpected({
      today: "2026-11-16",
      cash: 0,
      auto: toAutoExpected(lines({ invoices: [inv({ id: "sv", part: "deposit", notes: "DEPOSIT", projectHouseId: "s1", issueDate: "2026-11-15", balance: 100 })] })),
      manual: [{ id: "w", source: "walda", part: "deposit", invoiceId: "sv", amount: 10, date: "2026-12-01", label: "Village", note: null }],
    });
    expect(replaced.rows.some((row) => row.id === "inv:sv:deposit")).toBe(false);
    expect(replaced.rows.some((row) => row.id === "w")).toBe(true);
  });
});

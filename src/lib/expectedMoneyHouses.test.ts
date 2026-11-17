import { describe, expect, it } from "vitest";
import { MASSAIR_CT_ID, countAdminHome, fmtHomeRand } from "@/lib/adminHomeCount";
import { groupExpectedHouses, visibleHouseGroups } from "@/lib/expectedMoneyHouses";
import { payExpectSettings, type ExpectContext } from "@/lib/expectedPayDates";
import { buildYardHome } from "@/lib/yardView";

const CT = MASSAIR_CT_ID;
const TODAY = "2026-11-16";

function expectCtx(over: Partial<ExpectContext> = {}): ExpectContext {
  return {
    settings: payExpectSettings(null),
    houses: [
      { id: "h1", projectId: "sv", houseNo: "17528", unit: "Unit A" },
      { id: "h2", projectId: "sv", houseNo: "17529" },
      { id: "h4", projectId: "sv", houseNo: "17533" },
      { id: "h5", projectId: "sv", houseNo: "17534" },
    ],
    projects: [{ id: "sv", customerId: "c", name: "Stellenbosch Village", code: "SV" }],
    projectOverrides: [{ projectId: "sv", timing: "project", dateMode: "day_of_month", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: 15, monthOffset: 1 }],
    invoiceOverrides: [],
    jobs: [{ id: "j-rita", quoteId: "q-rita", completedAt: "2026-11-02T10:00:00+02:00", title: "Service" }],
    quotes: [],
    defaultDepositPct: 50,
    coverage: [],
    ...over,
  };
}

describe("expected money by house", () => {
  it("groups a project by house and keeps other jobs separate, with mixed deposit and final states", () => {
    const invoices = [
      { id: "d1", company_id: CT, status: "paid", sent_at: "2026-10-20", grand_total: 45000, notes: "DEPOSIT", invoice_number: "D-17528", customer_name: "Cape Estates", project_house_id: "h1", issue_date: "2026-10-20" },
      { id: "f1", company_id: CT, status: "sent", sent_at: "2026-11-13", grand_total: 65358.21, notes: "Final", invoice_number: "F-17528", customer_name: "Cape Estates", project_house_id: "h1", issue_date: "2026-11-13" },
      { id: "d2", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 40000, notes: "DEPOSIT", invoice_number: "D-17529", customer_name: "Cape Estates", project_house_id: "h2", issue_date: "2026-11-01" },
      { id: "d3", company_id: CT, status: "sent", sent_at: "2026-09-20", grand_total: 18000, notes: "DEPOSIT", invoice_number: "D-17533", customer_name: "Cape Estates", project_house_id: "h4", issue_date: "2026-09-20" },
      { id: "cover", company_id: CT, status: "sent", sent_at: "2026-11-10", grand_total: 80000, notes: "Final", invoice_number: "F-COVER", customer_name: "Cape Estates", project_house_id: null, issue_date: "2026-11-10" },
      { id: "nd", company_id: CT, status: "paid", sent_at: "2026-10-20", grand_total: 3000, notes: "DEPOSIT", invoice_number: "N-DEP", customer_name: "Rita Nkosi", quote_id: "q-rita", issue_date: "2026-10-20" },
      { id: "nf", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 7000, notes: "Final", invoice_number: "N-FIN", customer_name: "Rita Nkosi", quote_id: "q-rita", issue_date: "2026-11-01" },
    ];
    const payments = [
      { invoice_id: "d1", amount: 45000, status: "paid", payment_date: "2026-11-02" },
      { invoice_id: "d2", amount: 20000, status: "paid", payment_date: "2026-11-10" },
      { invoice_id: "nd", amount: 3000, status: "paid", payment_date: "2026-10-28" },
    ];
    const picture = groupExpectedHouses({
      companyId: CT,
      today: TODAY,
      invoices,
      payments,
      expect: expectCtx({
        coverage: [
          { invoiceId: "cover", projectHouseId: "h4", scope: "balance", amountIncl: 40000 },
          { invoiceId: "cover", projectHouseId: "h5", scope: "balance", amountIncl: 40000 },
        ],
      }),
      jobs: [{ id: "j-rita", title: "Service — 14 Beach Road", customerName: "Rita Nkosi", address: "14 Beach Road", quoteId: "q-rita" }],
    });
    const both = visibleHouseGroups(picture, "both");
    const village = both.find((group) => group.name === "Stellenbosch Village");
    expect(village?.code).toBe("SV");
    const byHouse = Object.fromEntries((village?.rows || []).map((row) => [row.house, row]));
    expect(byHouse["ERF 17528"].deposit[0]).toMatchObject({ chip: "Received 2 Nov", tone: "received" });
    expect(byHouse["ERF 17528"].final[0].chip).toBe("Due");
    expect(byHouse["ERF 17528"].final[0].expectedLabel).toContain("Expected 15 Dec");
    expect(byHouse["ERF 17528"].place).toContain("Unit A");
    expect(byHouse["ERF 17529"].deposit[0].chip).toBe("Part paid R 20 000,00 of R 40 000,00");
    expect(byHouse["ERF 17529"].deposit[0].tone).toBe("due");
    expect(byHouse["ERF 17533"].deposit[0].tone).toBe("late");
    expect(byHouse["ERF 17533, ERF 17534"] || byHouse["ERF 17534"]).toBeTruthy();
    const covered = (village?.rows || []).filter((row) => row.final.some((entry) => entry.invoiceId === "cover"));
    expect(covered).toHaveLength(2);
    expect(covered.every((row) => row.final[0].amountLabel === "R 40 000,00")).toBe(true);
    expect(covered.every((row) => row.final[0].expectedLabel.includes("Expected 15 Dec"))).toBe(true);
    const other = both.find((group) => group.id === "other");
    expect(other?.rows[0].house).toContain("Beach Road");
    expect(other?.rows[0].client).toBe("Rita Nkosi");
    expect(other?.rows[0].deposit[0].tone).toBe("received");
    expect(other?.rows[0].final[0].tone).toBe("late");

    const counts = countAdminHome({ companyId: CT, invoices, payments });
    const model = buildYardHome({ companyId: CT, now: new Date("2026-11-16T12:00:00+02:00"), invoices, payments, expect: expectCtx(), booksState: "ready", books: { receipts: [], commitments: [], allocations: [] } });
    expect(model.deposits.amountLabel).toBe(fmtHomeRand(counts.deposit.total));
    expect(model.finals.amountLabel).toBe(fmtHomeRand(counts.finalDue.total));
  });

  it("keeps an invoice on its project house when there is no coverage", () => {
    const picture = groupExpectedHouses({
      companyId: CT,
      today: TODAY,
      invoices: [{ id: "only", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 1000, notes: "DEPOSIT", invoice_number: "ONLY", customer_name: "Cape Estates", project_house_id: "h1", issue_date: "2026-11-01", expected_deposit_date: "2026-11-20" }],
      expect: null,
    });
    expect(picture.groups.map((group) => group.name)).toEqual(["Other jobs"]);
    expect(picture.groups[0].rows[0].deposit[0].invoiceNumber).toBe("ONLY");
  });
});

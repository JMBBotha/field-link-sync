import { describe, expect, it } from "vitest";
import { jobLiabilities, type Allocation, type Commitment, type Receipt } from "@/lib/cashHealth";
import { buildLiabilityPicture, LIABILITY_SOURCE } from "@/lib/liabilityLines";
import { fmtHomeRand } from "@/lib/adminHomeCount";
import { buildYardHome } from "@/lib/yardView";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";

const receipt = (over: Partial<Receipt>): Receipt => ({
  id: "r", source: "field_lynk", invoice_id: "inv", quote_id: null, ref: "0010019", client: "Cape Estates",
  part: "deposit", amount_incl: 5000, vat_incl: 0, expected_date: null, leeway_days: 0, confidence: 100,
  status: "received", received_date: "2026-11-01", note: null, ...over,
});

function line(over: Partial<Commitment> & { id: string }): Commitment {
  return {
    source_key: null, invoice_id: "inv", quote_id: null, job_id: "job-1", project: "0010019 Cape Estates",
    item: "AR3000 · Unit", kind: "unit", qty: 1, supplier: "Samsung", unit_cost_excl: 1000, vat_rate: 15,
    status: "needed", pay_date: "2026-11-09", note: null, ...over,
  };
}

describe("liability lines", () => {
  it("names the client, house, invoice, supplier and qty, and keeps the cash-health total", () => {
    const receipts = [receipt({})];
    const commitments = [
      line({ id: "c1", item: "AR3000 · Unit", qty: 2, unit_cost_excl: 1000, supplier: "Samsung" }),
      line({ id: "c2", item: "Bracket", kind: "material", qty: 4, unit_cost_excl: 50, supplier: null, job_id: null, pay_date: null }),
    ];
    const allocations: Allocation[] = [{ id: "a", stock_item_id: "s", commitment_id: "c1", qty: 1, drawn_at: null }];
    const picture = buildLiabilityPicture(receipts, commitments, allocations, {
      invoices: [{ id: "inv", invoiceNumber: "0010019", customerName: "Cape Estates", projectHouseId: "h1" }],
      houses: [{ id: "h1", projectId: "sv", houseNo: "17528", unit: "Unit A", projectName: "Stellenbosch Village", projectCode: "SV" }],
      jobs: [{ id: "job-1", title: "Install", address: "12 Oak", customerName: "Cape Estates" }],
    });
    const summary = jobLiabilities({ receipts, commitments, allocations });
    const shown = picture.groups.flatMap((group) => group.rows.flatMap((row) => row.lines));
    expect(picture.total).toBe(summary.total);
    expect(shown.reduce((sum, row) => sum + row.amount, 0)).toBe(summary.total);
    expect(picture.source).toBe(LIABILITY_SOURCE);
    const group = picture.groups[0];
    expect(group.name).toBe("Stellenbosch Village");
    expect(group.code).toBe("SV");
    const house = group.rows[0];
    expect(house.house).toBe("ERF 17528");
    expect(house.place).toContain("Unit A");
    const unit = shown.find((row) => row.id === "c1");
    expect(unit).toMatchObject({
      client: "Cape Estates",
      invoiceNumber: "0010019",
      supplier: "Samsung",
      code: "AR3000",
      description: "Unit",
      qtyLabel: "Qty 1",
      href: "/admin/jobs/job-1",
      payLabel: "Pay 9 Nov",
    });
    const bracket = shown.find((row) => row.id === "c2");
    expect(bracket?.href).toBe("/admin/invoices/inv");
    expect(bracket?.supplier).toBeNull();
    expect(bracket?.qtyLabel).toBe("Qty 4");

    const model = buildYardHome({
      companyId: MASSAIR_CT_ID,
      now: new Date("2026-11-16T12:00:00+02:00"),
      invoices: [{ id: "inv", company_id: MASSAIR_CT_ID, status: "sent", grand_total: 1, invoice_number: "0010019", customer_name: "Cape Estates", project_house_id: "h1" }],
      booksState: "ready",
      books: { receipts, commitments, allocations },
      expect: {
        settings: { projectDepositDays: 15, projectFinalDays: 15, windowExtraDays: 5, normalDepositDays: 3, normalFinalDays: 7, lateGraceDays: 3 },
        houses: [{ id: "h1", projectId: "sv", houseNo: "17528", unit: "Unit A" }],
        projects: [{ id: "sv", customerId: null, name: "Stellenbosch Village", code: "SV" }],
        projectOverrides: [],
        invoiceOverrides: [],
        jobs: [],
        quotes: [],
        defaultDepositPct: null,
      },
    });
    expect(model.liabilities.amountLabel).toBe(fmtHomeRand(summary.total));
    expect(model.liabilities.liabilities?.groups[0].name).toBe("Stellenbosch Village");
  });

  it("puts a normal job under Other jobs", () => {
    const receipts = [receipt({ invoice_id: "plain", ref: "N-1", client: "Rita Nkosi" })];
    const commitments = [line({ id: "c", invoice_id: "plain", job_id: "job-9", project: "N-1 Rita", item: "Copper", supplier: "One Stop" })];
    const picture = buildLiabilityPicture(receipts, commitments, [], {
      invoices: [{ id: "plain", invoiceNumber: "N-1", customerName: "Rita Nkosi" }],
      jobs: [{ id: "job-9", title: "Service — 14 Beach Road", address: "14 Beach Road, Sea Point", customerName: "Rita Nkosi" }],
    });
    expect(picture.groups[0].name).toBe("Other jobs");
    expect(picture.groups[0].rows[0].house).toBe("Service — 14 Beach Road");
    expect(picture.groups[0].rows[0].place).toContain("Beach Road");
    expect(picture.groups[0].rows[0].lines[0].href).toBe("/admin/jobs/job-9");
  });
});

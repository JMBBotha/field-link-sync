import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { countAdminHome, fmtHomeRand, MASSAIR_CT_ID, type HomeInvoice } from "@/lib/adminHomeCount";
import { jobLiabilities, type Allocation, type Commitment, type Receipt } from "@/lib/cashHealth";
import { homeMoneyFigures } from "@/lib/homeMoneyList";
import { buildYardHome } from "@/lib/yardView";
import { YardMoneyStrip } from "@/components/v8/roleHome/YardHome";

const CT = MASSAIR_CT_ID;
const round2 = (n: number) => Math.round(n * 100) / 100;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function invoice(over: Partial<HomeInvoice> & { id: string; grand_total: number }): HomeInvoice {
  return {
    company_id: CT,
    status: "sent",
    sent_at: "2026-11-01",
    notes: "Final",
    customer_name: "Raymond Kark",
    invoice_number: over.id,
    ...over,
  };
}

function commitment(over: Partial<Commitment> & { id: string; unit_cost_excl: number; pay_date: string | null }): Commitment {
  return {
    source_key: null, invoice_id: "dep-in", quote_id: null, job_id: "job-1", project: "JOB Raymond",
    item: "Outdoor unit", kind: "unit", qty: 1, supplier: "Samsung", vat_rate: 0, status: "needed", note: null, ...over,
  };
}

const received: Receipt = {
  id: "r", source: "field_lynk", invoice_id: "dep-in", quote_id: null, ref: "DEP", client: "Raymond Kark",
  part: "deposit", amount_incl: 1000, vat_incl: 0, expected_date: null, leeway_days: 0, confidence: 100,
  status: "received", received_date: "2026-11-01", note: null,
};

describe("home money list", () => {
  it("splits overdue out of the 7-day and 30-day totals without changing them", () => {
    const now = new Date("2026-11-17T08:04:00+02:00");
    const invoices = [
      invoice({ id: "f1", grand_total: 200000, expected_final_date: "2026-11-09" }),
      invoice({ id: "f2", grand_total: 150000, expected_final_date: "2026-11-10" }),
      invoice({ id: "f3", grand_total: 100000, expected_final_date: "2026-11-16" }),
      invoice({ id: "f4", grand_total: 63036, expected_final_date: "2026-11-01" }),
    ];
    const books = {
      receipts: [received],
      commitments: [
        commitment({ id: "c1", unit_cost_excl: 400000, pay_date: "2026-11-09" }),
        commitment({ id: "c2", unit_cost_excl: 165711, pay_date: "2026-11-16" }),
      ],
      allocations: [] as Allocation[],
    };
    const model = buildYardHome({
      companyId: CT,
      now,
      invoices,
      bankState: "ready",
      bank: {
        accounts: [{ id: "a", label: "FNB Business", account_ref: "…563591", include: true, sort: 1 }],
        balances: [{ id: "b", account_id: "a", balance: 38, as_of: "2026-11-16", created_at: "2026-11-16T08:00:00Z", source: "walda" }],
      },
      booksState: "ready",
      books,
    });
    const counts = countAdminHome({ companyId: CT, now, invoices });
    const figures = homeMoneyFigures(model);
    const by = (key: string) => figures.find((row) => row.key === key)!;
    const overdue = by("overdue").amount || 0;
    const due7 = by("due7").amount || 0;
    const due30 = by("due30").amount || 0;

    expect(round2(overdue + due7)).toBe(model.expected.next7);
    expect(round2(overdue + due7 + due30)).toBe(model.expected.next30);
    expect(model.expected.projected).toBe(round2((model.expected.cash || 0) + model.expected.next30));
    expect(by("projected").amount).toBe(model.expected.projected);
    expect(by("projected").amountLabel).toBe(model.expected.projectedLabel);
    expect(by("projected").explain).toBe("Cash on hand + money due in 30 days, including overdue. Liabilities are not subtracted.");
    expect(overdue).toBe(513036);
    expect(due7).toBe(0);
    expect(due30).toBe(0);
    expect(by("projected").amount).toBe(513074);

    expect(by("cash").amountLabel).toBe(model.cash.amountLabel);
    expect(by("cash").amountLabel).toBe(fmtHomeRand(38));
    expect(by("cash").explain).toBe("Money in the bank (FNB) as at 16 Nov, posted by WALDA.");
    expect(by("deposits").amountLabel).toBe(fmtHomeRand(counts.deposit.total));
    expect(by("finals").amountLabel).toBe(fmtHomeRand(counts.finalDue.total));
    expect(by("finals").amountLabel).toBe("R513 036");
    expect(by("overdue").explain).toMatch(/4 invoices/);

    const owed = jobLiabilities(books);
    const past = by("liabilities-overdue").amount || 0;
    const later = by("liabilities-upcoming").amount || 0;
    expect(round2(past + later)).toBe(owed.total);
    expect(model.liabilities.amountLabel).toBe(fmtHomeRand(owed.total));
    expect(past).toBe(owed.total);
    expect(later).toBe(0);
    expect(by("liabilities-overdue").explain).toMatch(/already past/);
    expect(by("liabilities-overdue").explain).not.toMatch(/Next pay/);
    expect(by("liabilities-upcoming").explain).toBe("Nothing to pay from today onward.");
    expect(figures.filter((row) => row.key === "cash")).toHaveLength(1);
  });

  it("keeps a dated split equal to the 7-day and 30-day totals, and leaves later money out", () => {
    const now = new Date("2026-11-07T08:00:00+02:00");
    const invoices = [
      invoice({ id: "late", grand_total: 1000, expected_final_date: "2026-11-01", customer_name: "Late" }),
      invoice({ id: "soon", grand_total: 8000, notes: "DEPOSIT", expected_deposit_date: "2026-11-12", customer_name: "Soon" }),
      invoice({ id: "month", grand_total: 22000, expected_final_date: "2026-11-28", customer_name: "Month" }),
      invoice({ id: "far", grand_total: 999, expected_final_date: "2027-02-01", customer_name: "Far" }),
    ];
    const model = buildYardHome({
      companyId: CT,
      now,
      invoices,
      bankState: "ready",
      bank: {
        accounts: [{ id: "a", label: "Current", account_ref: null, include: true, sort: 1 }],
        balances: [{ id: "b", account_id: "a", balance: 12500, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" }],
      },
      booksState: "ready",
      books: { receipts: [], commitments: [], allocations: [] },
    });
    const counts = countAdminHome({ companyId: CT, now, invoices });
    const figures = homeMoneyFigures(model);
    const by = (key: string) => figures.find((row) => row.key === key)!;
    expect(round2((by("overdue").amount || 0) + (by("due7").amount || 0))).toBe(model.expected.next7);
    expect(round2((by("overdue").amount || 0) + (by("due7").amount || 0) + (by("due30").amount || 0))).toBe(model.expected.next30);
    expect(by("overdue").amount).toBe(1000);
    expect(by("due7").amount).toBe(8000);
    expect(by("due30").amount).toBe(22000);
    expect(model.expected.next30).toBe(31000);
    expect(by("projected").amount).toBe(43500);
    expect(by("deposits").amountLabel).toBe(fmtHomeRand(counts.deposit.total));
    expect(by("finals").amountLabel).toBe(fmtHomeRand(counts.finalDue.total));
    expect(by("projected").info).toMatch(/left out/);
    expect(by("cash").explain).toBe("Money in the bank (Current) as at 3 Nov, typed in by a person.");
  });

  it("shows one cash row, a visible info line, and the house panel from a figure", () => {
    const now = new Date("2026-11-07T08:00:00+02:00");
    const model = buildYardHome({
      companyId: CT,
      now,
      invoices: [invoice({ id: "dep", grand_total: 8000, notes: "DEPOSIT", invoice_number: "DEP-9", customer_name: "Harbour", expected_deposit_date: "2026-11-12" })],
      bankState: "ready",
      bank: {
        accounts: [{ id: "a", label: "Current", account_ref: null, include: true, sort: 1 }],
        balances: [{ id: "b", account_id: "a", balance: 186400, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" }],
      },
      booksState: "ready",
      books: { receipts: [], commitments: [], allocations: [] },
    });
    render(<MemoryRouter><YardMoneyStrip model={model} /></MemoryRouter>);
    expect(screen.getAllByTestId("money-cash")).toHaveLength(1);
    expect(screen.queryByTestId("hero-cash")).toBeNull();
    expect(screen.getAllByText("Cash on hand")).toHaveLength(1);
    const info = screen.getByTestId("money-info-cash");
    expect(info).toHaveTextContent("Latest balance on Cash-flow health");
    expect(info).not.toHaveAttribute("title");
    expect(screen.getByTestId("money-date-cash")).toHaveTextContent("as at 3 Nov");
    expect(screen.getByTestId("expected-add")).toHaveTextContent("Add expected money");
    fireEvent.click(screen.getByTestId("money-deposits"));
    const panel = screen.getByTestId("yard-money-panel");
    expect(panel).toHaveTextContent("Harbour");
    expect(panel).toHaveTextContent("DEP-9");
    expect(screen.getByTestId("yard-money-line-dep")).toHaveAttribute("href", "/admin/invoices/dep");
  });
});

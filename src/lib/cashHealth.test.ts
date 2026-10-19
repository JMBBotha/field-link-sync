import { describe, expect, it } from "vitest";
import { alerts, forecast, monthlyOverheads, overheadEvents, projects, stillToPay, vatPeriodFor, type CashHealthData, type Commitment, type Overhead, type Receipt } from "./cashHealth";

const settings = { company_id: "c", enabled: true, buffer_mode: "overheads_month", buffer_amount: 0, unit_cost_factor: 0.8, default_leeway_days: 7, conf_sent: 90, conf_overdue: 70, conf_draft: 60,
  conf_final_before_install: 50, vat_number: "4630313080", vat_basis: "invoice", vat_period_months: 2, vat_period_end: "2026-10-31", vat_due_day: 25, vat_rate: 15 } as const;
const ov = (o: Partial<Overhead>): Overhead => ({ id: Math.random().toString(), name: "x", category: "other", amount: 0, frequency: "monthly", pay_day: 1, pay_date: null, start_date: null, end_date: null, active: true, sort: 0, note: null, ...o });
const rc = (o: Partial<Receipt>): Receipt => ({ id: Math.random().toString(), source: "field_lynk", invoice_id: "i1", quote_id: null, ref: "0010004", client: "AVEC", part: "deposit", amount_incl: 0, vat_incl: 0, expected_date: null, leeway_days: 7, confidence: 60, status: "expected", received_date: null, note: null, ...o });
const cm = (o: Partial<Commitment>): Commitment => ({ id: Math.random().toString(), source_key: null, invoice_id: "i1", quote_id: null, job_id: null, project: "0010004 AVEC", item: "AR12", kind: "unit", qty: 1, supplier: "Samsung / Fourways", unit_cost_excl: 10000, vat_rate: 15, status: "needed", pay_date: null, note: null, ...o });
const base = (p: Partial<CashHealthData> = {}): CashHealthData => ({ settings: { ...settings }, receipts: [], commitments: [], stock: [], allocations: [], overheads: [], accounts: [{ id: "a", label: "FNB", account_ref: "563591", include: true, sort: 0 }],
  balances: [{ id: "b", account_id: "a", balance: 100000, as_of: "2026-10-19", created_at: "2026-10-19T06:00:00Z" }], invoices: [{ id: "i1", invoice_number: "0010004", status: "draft", issue_date: "2026-10-12", tax_amount: 9968.71, grand_total: 76426.79 }],
  vat: { current: { output_invoice: 0, output_payment: 0, input: 0 }, previous: { output_invoice: 0, output_payment: 0, input: 0 } }, ...p });
const today = new Date(2026, 9, 19); // Mon 19 Oct 2026

describe("cash health", () => {
  it("monthly overheads: weekly x 52/12 + monthly", () => {
    expect(monthlyOverheads([ov({ amount: 6500, frequency: "weekly" }), ov({ amount: 1000, frequency: "weekly" }), ov({ amount: 4500 }), ov({ amount: 35000, pay_day: 25 })])).toBe(72000);
  });
  it("overhead events land on their pay days", () => {
    const ev = overheadEvents([ov({ amount: 35000, pay_day: 25, name: "Owner" }), ov({ amount: 6500, frequency: "weekly", pay_day: 5, name: "Wages" })], today, new Date(2026, 9, 31));
    expect(ev.filter((e) => e.name === "Owner").map((e) => e.date)).toEqual(["2026-10-25"]);
    expect(ev.filter((e) => e.name === "Wages").map((e) => e.date)).toEqual(["2026-10-23", "2026-10-30"]);
  });
  it("VAT periods: 2-monthly from the anchor, due on the 25th of the next month", () => {
    expect(vatPeriodFor(settings, today)).toEqual({ start: "2026-09-01", end: "2026-10-31", due: "2026-11-25" });
    expect(vatPeriodFor(settings, new Date(2026, 10, 3))).toEqual({ start: "2026-11-01", end: "2026-12-31", due: "2027-01-25" });
    expect(vatPeriodFor(settings, new Date(2026, 6, 3)).end).toBe("2026-08-31");
  });
  it("stock allocation removes cash still to pay; ordered/paid needs no more cash", () => {
    const c = cm({ qty: 2 });
    expect(stillToPay(c, [])).toBe(23000);
    expect(stillToPay(c, [{ id: "x", stock_item_id: "s", commitment_id: c.id, qty: 1, drawn_at: null }])).toBe(11500);
    expect(stillToPay(cm({ status: "ordered_paid" }), [])).toBe(0);
  });
  it("forecast: red when units are paid before the deposit lands; cautious line weights by confidence and leeway", () => {
    const d = base({ receipts: [rc({ amount_incl: 50000, expected_date: "2026-11-02", confidence: 60 })], commitments: [cm({ qty: 10, pay_date: "2026-10-20" })] });
    const f = forecast(d, today);
    expect(f.weeks[0].units).toBe(115000);
    expect(f.lowest.value).toBeLessThan(0);
    expect(f.health).toBe("red");
    expect(f.runwayWeeks).toBe(0);
    expect(f.weeks[2].inExpected).toBe(50000);
    expect(f.weeks[3].inCautious).toBe(30000); // 2 Nov + 7 days -> week of 9 Nov
    expect(alerts(d, f, today).some((a) => a.tone === "red" && a.text.includes("below R0"))).toBe(true);
  });
  it("forecast: invoice-basis VAT on a draft lands in its period and is paid on the due date", () => {
    const d = base({ receipts: [rc({ amount_incl: 38213.4, expected_date: "2026-10-26" })] });
    const f = forecast(d, today);
    expect(f.vatSummary.expectedOutput).toBeCloseTo(9968.71, 2);
    const due = f.weeks.findIndex((w) => w.start === "2026-11-23");
    expect(f.weeks[due].vat).toBeCloseTo(9968.71, 2);
  });
  it("green when nothing dips under the buffer", () => {
    const f = forecast(base({ overheads: [ov({ amount: 1000 })] }), today);
    expect(f.health).toBe("green");
  });
  it("projects: cover = deposit - still to buy", () => {
    const d = base({ receipts: [rc({ amount_incl: 38213.4 }), rc({ part: "final", amount_incl: 38213.39 })], commitments: [cm({ unit_cost_excl: 38335.82 })] });
    const [p] = projects(d);
    expect(p.invoiceValue).toBeCloseTo(76426.79, 2);
    expect(p.cover).toBeCloseTo(38213.4 - 44086.19, 1);
  });
});

/** Signed-out sample rows for /dev/cash-health. Not Massair CT. Nothing here is saved. */
import type { CashHealthActions } from "@/hooks/useCashHealth";
import type { CashHealthData, InvoiceLite, Receipt } from "@/lib/cashHealth";

export const FIXTURE_TODAY = new Date(2026, 10, 7);

const settings: CashHealthData["settings"] = {
  company_id: "00000000-0000-4000-8000-00000000f17e",
  enabled: true, buffer_mode: "overheads_month", buffer_amount: 0, unit_cost_factor: 0.8, default_leeway_days: 7,
  conf_sent: 90, conf_overdue: 70, conf_draft: 60, conf_final_before_install: 50,
  vat_number: null, vat_basis: "invoice", vat_period_months: 2, vat_period_end: "2026-10-31", vat_due_day: 25, vat_rate: 15,
  forecast_start: null,
};

const rc = (o: Partial<Receipt> & Pick<Receipt, "id" | "ref" | "client" | "part" | "invoice_id" | "amount_incl">): Receipt => ({
  source: "field_lynk", quote_id: null, vat_incl: 0, expected_date: "2026-11-09", leeway_days: 7, confidence: 60,
  status: "expected", received_date: null, note: null, ...o,
});

const houseInv = (id: string, num: string, status: string, house: string, extra: Partial<InvoiceLite> = {}): InvoiceLite => ({
  id, invoice_number: num, status, issue_date: "2026-10-12", tax_amount: 1000, grand_total: 8000,
  project_house: { id: `house-${house}`, house_no: house, project_id: "proj-fixture", project: { name: "Fixture Estate" } },
  ...extra,
});

/** Ordinary client. Notes mention a house on purpose; the list must not turn that into a house label. */
const plainInv = (id: string, num: string, notes: string): InvoiceLite & { notes: string } => ({
  id, invoice_number: num, status: "sent", issue_date: "2026-10-12", tax_amount: 500, grand_total: 4000, project_house: null, notes,
});

export const cashHealthFixture: CashHealthData = {
  settings,
  receipts: [
    rc({ id: "r12", ref: "FX-2001", client: "Fixture Estate (Pty) Ltd", part: "deposit", invoice_id: "i12", amount_incl: 12000, expected_date: "2026-11-01", note: "Assumed date (fixture) – change when you know" }),
    rc({ id: "r310", ref: "FX-310", client: "Rita Nkosi", part: "full", invoice_id: "i310", amount_incl: 22798, confidence: 90 }),
    rc({ id: "r14", ref: "FX-2002", client: "Fixture Estate (Pty) Ltd", part: "final", invoice_id: "i14", amount_incl: 38213, expected_date: null, confidence: 50 }),
    rc({ id: "r27", ref: "FX-2003", client: "Fixture Estate (Pty) Ltd", part: "final", invoice_id: "i27", amount_incl: 38213, expected_date: null, confidence: 50 }),
    rc({ id: "r41", ref: "FX-2004", client: "Fixture Estate (Pty) Ltd", part: "final", invoice_id: "i41", amount_incl: 38213, expected_date: null, confidence: 50 }),
    rc({ id: "r8", ref: "FX-2006", client: "Fixture Estate (Pty) Ltd", part: "final", invoice_id: "i8", amount_incl: 15000, expected_date: null, confidence: 50 }),
    rc({ id: "r3", ref: "FX-2005", client: "Fixture Estate (Pty) Ltd", part: "full", invoice_id: "i3", amount_incl: 8592, confidence: 100 }),
    rc({ id: "r311", ref: "FX-311", client: "Sam Peters", part: "final", invoice_id: "i311", amount_incl: 8592, confidence: 100 }),
  ],
  commitments: [], stock: [], allocations: [], overheads: [],
  accounts: [{ id: "a", label: "Fixture bank", account_ref: "0000", include: true, sort: 0 }],
  balances: [{ id: "b", account_id: "a", balance: 100000, as_of: "2026-11-02", created_at: "2026-11-02T06:00:00Z" }],
  invoices: [
    houseInv("i12", "FX-2001", "draft", "12", { due_date: "2026-12-01", due_date_source: "manual", final_unscheduled: true }),
    houseInv("i14", "FX-2002", "sent", "14", { due_date: "2026-12-01", due_date_source: "manual", expected_final_date: null, final_unscheduled: true }),
    houseInv("i27", "FX-2003", "sent", "27", { due_date: "2027-01-01", due_date_source: "manual", expected_final_date: null, final_unscheduled: true }),
    houseInv("i41", "FX-2004", "sent", "41", { expected_final_date: "2027-03-01", due_date: "2026-10-12", due_date_source: "terms", final_unscheduled: true }),
    houseInv("i8", "FX-2006", "sent", "8", { due_date: "2026-10-12", due_date_source: "terms", final_unscheduled: true }),
    houseInv("i3", "FX-2005", "sent", "3"),
    plainInv("i310", "FX-310", "HOUSE 99 - Fixture Estate\nThanks"),
    plainInv("i311", "FX-311", "Service at the shop. HOUSE 5"),
  ],
  vat: { current: { output_invoice: 0, output_payment: 0, input: 0 }, previous: { output_invoice: 0, output_payment: 0, input: 0 } },
};

const noop = async () => {};
export const cashHealthFixtureActions: CashHealthActions = {
  saveBalance: noop, addAccount: noop, updateAccount: noop, updateReceipt: noop, addReceipt: noop, deleteReceipt: noop,
  updateCommitment: noop, addCommitment: noop, deleteCommitment: noop, allocate: noop, unallocate: noop, stockTake: noop,
  updateStock: noop, saveOverhead: noop, deleteOverhead: noop, saveSettings: noop, resync: noop,
};

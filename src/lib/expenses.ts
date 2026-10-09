/** Unified expenses (accounting step 4). VAT is computed server-side; these helpers mirror it for the form preview. */
export const EXPENSE_CATEGORIES = [
  ["materials", "Materials & parts"],
  ["equipment", "Equipment / units"],
  ["subcontractor", "Subcontractor"],
  ["fuel_travel", "Fuel & travel"],
  ["vehicle", "Vehicle"],
  ["tools", "Tools"],
  ["rent", "Rent"],
  ["utilities", "Utilities"],
  ["telecoms", "Phone & internet"],
  ["insurance", "Insurance"],
  ["professional_fees", "Professional fees"],
  ["bank_charges", "Bank charges"],
  ["marketing", "Marketing"],
  ["office", "Office"],
  ["other", "Other"],
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number][0];
export const categoryLabel = (c: string | null | undefined) => EXPENSE_CATEGORIES.find(([k]) => k === c)?.[1] ?? "Other";

/** SA VAT rate by document date: 14% before 1 April 2018, 15% from then (same as DB vat_rate_for). */
export function vatRateFor(date: string | Date): number {
  const d = typeof date === "string" ? date.slice(0, 10) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return d < "2018-04-01" ? 14 : 15;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Split a VAT-inclusive amount (same rounding as the DB trigger). */
export function splitInclusive(amountIncl: number, date: string, claimable = true) {
  const incl = r2(Number(amountIncl) || 0);
  const rate = claimable ? vatRateFor(date) : 0;
  const vat = r2((incl * rate) / (100 + rate));
  return { rate, vat, excl: r2(incl - vat), incl };
}

export interface ExpenseRow {
  id: string;
  company_id: string;
  expense_date: string;
  supplier_id: string | null;
  supplier_name: string | null;
  category: string;
  description: string | null;
  amount_incl: number;
  vat_claimable: boolean;
  vat_rate: number;
  vat_amount: number;
  amount_excl: number;
  payment_method: string | null;
  reference: string | null;
  receipt_path: string | null;
  job_id: string | null;
  source: string;
  status: "active" | "archived";
  created_at: string;
}

export function expenseTotals(rows: Pick<ExpenseRow, "amount_incl" | "vat_amount" | "amount_excl" | "status">[]) {
  const t = { incl: 0, vat: 0, excl: 0, count: 0 };
  for (const r of rows) {
    if (r.status === "archived") continue;
    t.incl += Number(r.amount_incl) || 0;
    t.vat += Number(r.vat_amount) || 0;
    t.excl += Number(r.amount_excl) || 0;
    t.count++;
  }
  return { incl: r2(t.incl), vat: r2(t.vat), excl: r2(t.excl), count: t.count };
}

/** Private-bucket path: <company>/expenses/<uuid>.<ext> */
export function receiptPath(companyId: string, fileName: string, id: string = crypto.randomUUID()) {
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  return `${companyId}/expenses/${id}.${ext}`;
}

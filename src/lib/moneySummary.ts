import { supabase } from "@/integrations/supabase/client";
import { sumSettled } from "@/lib/payments";

/**
 * Company money summary (Johan 2026-09-26).
 * Balance = grand_total − settled payments (SETTLED_PAYMENT_STATUSES, same as invoice_amount_paid).
 */
export interface MoneyInvoice {
  id: string;
  status: string | null;
  grand_total: number | string | null;
  notes?: string | null;
  quote_id?: string | null;
}
export interface MoneyPayment {
  invoice_id: string;
  amount: number | string;
  status?: string | null;
  gateway?: string | null;
}
export interface MoneyBucket { count: number; balance: number }
export interface MoneySummary { depositsDue: MoneyBucket; partiallyPaid: MoneyBucket; outstanding: MoneyBucket }

export type MoneyFilter = "deposits_due" | "partially_paid" | "outstanding";

const r2 = (n: number) => Math.round(n * 100) / 100;
const CLOSED = new Set(["paid", "cancelled", "void"]);

export const isDepositInvoice = (inv: MoneyInvoice) =>
  !!inv.quote_id || (inv.notes ?? "").trim().toUpperCase().startsWith("DEPOSIT");

export function invoiceMoney(inv: MoneyInvoice, payments: MoneyPayment[]) {
  const paid = sumSettled(payments.filter((p) => p.invoice_id === inv.id));
  const balance = Math.max(0, r2((Number(inv.grand_total) || 0) - paid));
  return { paid, balance };
}

/** Which dashboard bucket(s) an invoice falls in. */
export function matchesMoneyFilter(inv: MoneyInvoice, paid: number, balance: number, f: MoneyFilter): boolean {
  if (CLOSED.has(inv.status ?? "") || balance <= 0) return false;
  if (f === "outstanding") return true;
  if (f === "partially_paid") return paid > 0;
  return isDepositInvoice(inv) && paid <= 0;
}

export function computeMoneySummary(invoices: MoneyInvoice[], payments: MoneyPayment[]): MoneySummary {
  const out: MoneySummary = {
    depositsDue: { count: 0, balance: 0 },
    partiallyPaid: { count: 0, balance: 0 },
    outstanding: { count: 0, balance: 0 },
  };
  const add = (b: MoneyBucket, v: number) => { b.count += 1; b.balance = r2(b.balance + v); };
  for (const inv of invoices) {
    const { paid, balance } = invoiceMoney(inv, payments);
    if (matchesMoneyFilter(inv, paid, balance, "outstanding")) add(out.outstanding, balance);
    if (matchesMoneyFilter(inv, paid, balance, "partially_paid")) add(out.partiallyPaid, balance);
    if (matchesMoneyFilter(inv, paid, balance, "deposits_due")) add(out.depositsDue, balance);
  }
  return out;
}

export async function fetchMoneySummary(companyId: string): Promise<MoneySummary> {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, status, grand_total, notes, quote_id")
    .eq("company_id", companyId);
  if (error) throw error;
  const ids = (invoices || []).map((i: any) => i.id);
  let payments: MoneyPayment[] = [];
  if (ids.length) {
    const { data: pays, error: pErr } = await supabase
      .from("payments")
      .select("invoice_id, amount, status, gateway")
      .in("invoice_id", ids);
    if (pErr) throw pErr;
    payments = (pays || []) as MoneyPayment[];
  }
  return computeMoneySummary((invoices || []) as MoneyInvoice[], payments);
}

/** Per-lead money rows for /admin/money (Johan 2026-09-26). Open (unpaid/part-paid) invoices only, biggest balance first. */
export interface LeadMoneyInvoice extends MoneyInvoice {
  lead_id?: string | null;
  customer_name?: string | null;
  invoice_number?: string | null;
}
export interface LeadMoneyRow {
  key: string;
  leadId: string | null;
  customerName: string;
  invoiceNumbers: string[];
  firstInvoiceId: string;
  quoteId: string | null;
  depositDue: number;
  paid: number;
  balance: number;
}

export function computeLeadMoney(invoices: LeadMoneyInvoice[], payments: MoneyPayment[]): LeadMoneyRow[] {
  const rows = new Map<string, LeadMoneyRow>();
  for (const inv of invoices) {
    const { paid, balance } = invoiceMoney(inv, payments);
    if (!matchesMoneyFilter(inv, paid, balance, "outstanding")) continue;
    const key = inv.lead_id || `inv:${inv.id}`;
    const row = rows.get(key) ?? {
      key, leadId: inv.lead_id ?? null, customerName: inv.customer_name || "—",
      invoiceNumbers: [], firstInvoiceId: inv.id, quoteId: inv.quote_id ?? null,
      depositDue: 0, paid: 0, balance: 0,
    };
    if (inv.invoice_number) row.invoiceNumbers.push(inv.invoice_number);
    if (!row.quoteId && inv.quote_id) row.quoteId = inv.quote_id;
    if (matchesMoneyFilter(inv, paid, balance, "deposits_due")) row.depositDue = r2(row.depositDue + balance);
    row.paid = r2(row.paid + paid);
    row.balance = r2(row.balance + balance);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.balance - a.balance);
}

export async function fetchLeadMoney(companyId: string): Promise<LeadMoneyRow[]> {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, status, grand_total, notes, quote_id, lead_id, customer_name, invoice_number")
    .eq("company_id", companyId);
  if (error) throw error;
  const ids = (invoices || []).map((i: any) => i.id);
  let payments: MoneyPayment[] = [];
  if (ids.length) {
    const { data: pays, error: pErr } = await supabase
      .from("payments").select("invoice_id, amount, status, gateway").in("invoice_id", ids);
    if (pErr) throw pErr;
    payments = (pays || []) as MoneyPayment[];
  }
  return computeLeadMoney((invoices || []) as LeadMoneyInvoice[], payments);
}

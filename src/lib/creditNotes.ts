import { supabase } from "@/integrations/supabase/client";

/** Accounting step 2: credit notes (write-offs, deductions, discounts, rounding). Issued only via issue_credit_note(). */
export type CreditReason = "write_off" | "deduction" | "discount" | "rounding" | "other";
export const CREDIT_REASONS: { value: CreditReason; label: string }[] = [
  { value: "write_off", label: "Write-off (bad debt)" },
  { value: "deduction", label: "Deduction (client deducted)" },
  { value: "discount", label: "Discount after invoicing" },
  { value: "rounding", label: "Rounding (small balance)" },
  { value: "other", label: "Other" },
];
export const reasonLabel = (r: string) => CREDIT_REASONS.find((x) => x.value === r)?.label ?? r;

export interface CreditNoteRow {
  id: string;
  invoice_id: string;
  credit_note_number: string;
  issue_date: string;
  reason: string;
  description: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  status: "issued" | "void" | string;
  void_reason?: string | null;
}

/** VAT inside a VAT-inclusive amount, e.g. R115 at 15% → R15. */
export function vatFromInclusive(amount: number, ratePct: number): number {
  const a = Number(amount) || 0, r = Number(ratePct) || 0;
  if (r <= 0) return 0;
  return Math.round(((a * r) / (100 + r)) * 100) / 100;
}

/** Sum of issued (not void) credit notes per invoice. */
export function creditedByInvoice(rows: { invoice_id: string; total: number | string; status?: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of rows) {
    if ((c.status ?? "issued") !== "issued") continue;
    m.set(c.invoice_id, Math.round(((m.get(c.invoice_id) || 0) + (Number(c.total) || 0)) * 100) / 100);
  }
  return m;
}

/** Suggested reason for a remaining balance: tiny amounts are rounding. */
export const suggestReason = (outstanding: number): CreditReason => (outstanding > 0 && outstanding <= 5 ? "rounding" : "write_off");

export async function fetchCreditNotes(invoiceIds: string[]): Promise<CreditNoteRow[]> {
  if (!invoiceIds.length) return [];
  const { data, error } = await (supabase.from("credit_notes" as any) as any)
    .select("id, invoice_id, credit_note_number, issue_date, reason, description, subtotal, tax_rate, tax_amount, total, status, void_reason")
    .in("invoice_id", invoiceIds)
    .order("created_at", { ascending: true });
  if (error) return []; // not readable (techs, public) → no credits shown
  return (data ?? []) as CreditNoteRow[];
}

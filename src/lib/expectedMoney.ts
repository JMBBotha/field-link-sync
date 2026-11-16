/** Expected money on admin Home.
 *  Open invoices supply deposit and final balances (the same lines as the money tiles).
 *  A hand entry or a WALDA row linked to an invoice replaces that invoice's auto figure.
 *  Rows synced from invoices (source field_lynk) are not added again.
 *  Nothing here writes an invoice or a payment. */
import { fmtHomeRand } from "@/lib/adminHomeCount";

export type ExpectedKind = "deposit" | "final" | "other";

export interface AutoExpected {
  invoiceId: string;
  part: "deposit" | "final";
  amount: number;
  /** YYYY-MM-DD, or null when the invoice has no stored date. */
  date: string | null;
  label: string;
  href: string;
}

export interface ManualExpected {
  id: string;
  source: "manual" | "walda";
  part: ExpectedKind | "full" | "progress";
  invoiceId: string | null;
  amount: number;
  date: string | null;
  label: string;
  note: string | null;
}

export interface ExpectedRow {
  id: string;
  kind: ExpectedKind;
  label: string;
  amount: number;
  amountLabel: string;
  date: string | null;
  dateLabel: string;
  href: string | null;
  /** Hand and WALDA rows can be marked received or cancelled. Invoice rows cannot. */
  tap: boolean;
  overdue: boolean;
  in7: boolean;
  in30: boolean;
}

export interface ExpectedPicture {
  cash: number | null;
  cashLabel: string;
  next7: number;
  next7Label: string;
  next30: number;
  next30Label: string;
  /** Cash on hand plus the next 30 days, including overdue. Null until a bank balance is entered. */
  projected: number | null;
  projectedLabel: string;
  rows: ExpectedRow[];
}

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function money(n: number): string {
  return fmtHomeRand(Math.round(n * 100) / 100);
}

function kindOf(part: ManualExpected["part"]): ExpectedKind {
  if (part === "deposit") return "deposit";
  if (part === "final") return "final";
  return "other";
}

const KIND_WORD: Record<ExpectedKind, string> = { deposit: "Deposit", final: "Final", other: "Other" };

/** A manual or WALDA row linked to an invoice stands in for that invoice's auto figure. */
export function replacedInvoiceKeys(manual: ManualExpected[]): Set<string> {
  const keys = new Set<string>();
  for (const row of manual) {
    if (!row.invoiceId) continue;
    if (row.part === "other" || row.part === "full" || row.part === "progress") keys.add(`${row.invoiceId}:*`);
    else keys.add(`${row.invoiceId}:${row.part}`);
  }
  return keys;
}

export function projectExpected(input: {
  today: string;
  cash: number | null;
  auto?: AutoExpected[];
  manual?: ManualExpected[];
}): ExpectedPicture {
  const today = day(input.today) || input.today.slice(0, 10);
  const end7 = addDays(today, 6);
  const end30 = addDays(today, 29);
  const manual = (input.manual || []).filter((row) => Number.isFinite(row.amount) && row.amount > 0);
  const replaced = replacedInvoiceKeys(manual);
  const rows: ExpectedRow[] = [];

  for (const line of input.auto || []) {
    if (!(line.amount > 0)) continue;
    if (replaced.has(`${line.invoiceId}:*`) || replaced.has(`${line.invoiceId}:${line.part}`)) continue;
    const date = day(line.date);
    rows.push(rowFrom({
      id: `inv:${line.invoiceId}:${line.part}`,
      kind: line.part,
      label: line.label,
      amount: line.amount,
      date,
      href: line.href,
      tap: false,
      today,
      end7,
      end30,
    }));
  }

  for (const line of manual) {
    const date = day(line.date);
    const kind = kindOf(line.part);
    const who = line.source === "walda" ? "WALDA" : "Added";
    rows.push(rowFrom({
      id: line.id,
      kind,
      label: `${who} · ${line.label}`,
      amount: line.amount,
      date,
      href: line.invoiceId ? `/admin/invoices/${line.invoiceId}` : null,
      tap: true,
      today,
      end7,
      end30,
      note: line.note,
    }));
  }

  rows.sort((a, b) => (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") || a.label.localeCompare(b.label));
  const next7 = round2(rows.filter((row) => row.in7).reduce((sum, row) => sum + row.amount, 0));
  const next30 = round2(rows.filter((row) => row.in30).reduce((sum, row) => sum + row.amount, 0));
  const cash = input.cash == null || !Number.isFinite(input.cash) ? null : round2(input.cash);
  const projected = cash == null ? null : round2(cash + next30);
  return {
    cash,
    cashLabel: cash == null ? "—" : money(cash),
    next7,
    next7Label: money(next7),
    next30,
    next30Label: money(next30),
    projected,
    projectedLabel: projected == null ? "—" : money(projected),
    rows,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function rowFrom(input: {
  id: string;
  kind: ExpectedKind;
  label: string;
  amount: number;
  date: string | null;
  href: string | null;
  tap: boolean;
  today: string;
  end7: string;
  end30: string;
  note?: string | null;
}): ExpectedRow {
  const overdue = !!input.date && input.date < input.today;
  // Overdue is inside both windows (it should already be in). Undated is in neither.
  const in30 = !!input.date && input.date <= input.end30;
  const in7 = !!input.date && input.date <= input.end7;
  const note = (input.note || "").trim();
  return {
    id: input.id,
    kind: input.kind,
    label: note ? `${input.label} · ${note}` : input.label,
    amount: round2(input.amount),
    amountLabel: money(input.amount),
    date: input.date,
    dateLabel: !input.date ? "No date" : overdue ? `Overdue · ${KIND_WORD[input.kind]}` : `${KIND_WORD[input.kind]} · ${input.date.slice(8, 10)} ${monthWord(input.date)}`,
    href: input.href,
    tap: input.tap,
    overdue,
    in7,
    in30,
  };
}

function monthWord(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}

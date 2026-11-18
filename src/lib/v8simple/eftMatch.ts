/**
 * V8 EFT match over the same bank_lines shape the FNB import already stores
 * (reference, description, amount, txn_date, status). Auto-match needs the
 * quote or invoice number in the reference, then the same amount to the cent.
 * Anything else stays for a manual "EFT received". The live Bank page is unchanged.
 */
export interface V8BankLine {
  id: string;
  amount: number;
  reference?: string | null;
  description?: string | null;
  txnDate: string;
  status?: "new" | "matched" | "ignored";
}

export interface V8EftExpect {
  id: string;
  quoteNo: string;
  invoiceNo: string;
  amount: number;
  client: string;
}

export interface V8EftMatch {
  lineId: string;
  expectId: string;
  via: "auto";
  amount: number;
  date: string;
  reference: string;
}

const norm = (value: string | null | undefined) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function mentions(line: V8BankLine, code: string): boolean {
  const needle = norm(code);
  if (needle.length < 3) return false;
  const hay = norm(`${line.reference || ""} ${line.description || ""}`);
  return hay.includes(needle);
}

const sameMoney = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;

/** Reference first, then the amount. Both are required for an automatic match. */
export function v8AutoMatchEft(lines: V8BankLine[], expects: V8EftExpect[]): { matched: V8EftMatch[]; unmatched: V8BankLine[] } {
  const open = expects.filter((row) => row.amount > 0);
  const used = new Set<string>();
  const matched: V8EftMatch[] = [];
  const unmatched: V8BankLine[] = [];
  for (const line of lines) {
    if (line.status && line.status !== "new") continue;
    if (!(line.amount > 0)) continue;
    const hit = open.find((row) => !used.has(row.id) && (mentions(line, row.quoteNo) || mentions(line, row.invoiceNo)) && sameMoney(line.amount, row.amount));
    if (!hit) { unmatched.push(line); continue; }
    used.add(hit.id);
    matched.push({
      lineId: line.id,
      expectId: hit.id,
      via: "auto",
      amount: hit.amount,
      date: line.txnDate,
      reference: hit.quoteNo || hit.invoiceNo,
    });
  }
  return { matched, unmatched };
}

export interface V8ManualEft {
  expectId: string;
  amount: number;
  date: string;
  who: string;
  via: "manual";
}

/** Fallback for a line the matcher could not take. Recording it marks the deposit paid. */
export function v8MarkEftReceived(expect: V8EftExpect, input: { amount: number; date: string; who: string }): V8ManualEft | { error: string } {
  if (!input.who.trim()) return { error: "Who recorded it is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Date is required." };
  if (!sameMoney(input.amount, expect.amount)) return { error: "Amount must match the deposit." };
  return { expectId: expect.id, amount: expect.amount, date: input.date, who: input.who.trim(), via: "manual" };
}

/** Undo only on the same Johannesburg day it was recorded. */
export function v8CanUndoEft(recordedOn: string, today: string): boolean {
  return recordedOn === today;
}

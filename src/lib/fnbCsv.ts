/**
 * FNB bank CSV parser (accounting step 5). Handles FNB's exports:
 *  - Online banking "Transaction history" / "CSV" downloads: preamble rows, then a header row with
 *    Date, Amount, Balance, Description (and optionally Reference / Service Fee / Effective Date).
 *  - "CSV Date Number" (Online Banking Enterprise): no header row; transaction rows are
 *    statement date (DD/MM/CCYY), statement no., narrative, cheque/ref, amount, txn date (DD/MM), balance.
 * Dates: CCYYMMDD, CCYY/MM/DD, CCYY-MM-DD, DD/MM/CCYY, "DD Mon CCYY", "DD Mon" (year inferred).
 * Amounts: "-1,234.56", "1 234.56", "R1234.56", "1234.56Cr", "123.45Dr", "(12.00)". Debits are negative.
 */
export interface BankLine { date: string; amount: number; description: string; reference: string | null; balance: number | null }
export interface ParseResult { lines: BankLine[]; account: string | null; format: "header" | "date-number" | "unknown"; skipped: number }

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^'(.*)'$/, "$1").trim());
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

export function parseFnbDate(raw: string, fallbackYear = new Date().getFullYear()): string | null {
  const s = (raw || "").trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/))) return ymd(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s*(\d{4})?$/))) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? ymd(m[3] ? +m[3] : fallbackYear, mo, +m[1]) : null;
  }
  return null;
}

export function parseFnbAmount(raw: string): number | null {
  let s = (raw || "").trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/dr$/i.test(s)) { sign = -1; s = s.slice(0, -2); }
  else if (/cr$/i.test(s)) s = s.slice(0, -2);
  s = s.replace(/^R\s*/i, "").replace(/[\s\u00a0]/g, "");
  if (/^-?\d+,\d{2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s) * sign;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const findCol = (h: string[], ...res: RegExp[]) => {
  for (const re of res) {
    const i = h.findIndex((c) => re.test(c));
    if (i >= 0) return i;
  }
  return -1;
};

export function parseFnbCsv(text: string, today = new Date()): ParseResult {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "").map(splitCsvLine);
  let account: string | null = null;
  for (const r of rows.slice(0, 12)) {
    const joined = r.join(" ");
    const m = joined.match(/(?:account|acc(?:ount)?\s*(?:no|number)?)[^0-9]*(\d[\d\s-]{5,})/i) || (r.length >= 2 && /^\d{1,2}$/.test(r[0]) && /^\d{8,}$/.test(r[1].replace(/\D/g, "")) ? [null, r[1]] as any : null);
    if (m && !account) { const digits = String(m[1]).replace(/\D/g, ""); if (digits.length >= 6) account = `FNB ..${digits.slice(-4)}`; }
  }
  const lines: BankLine[] = [];
  let skipped = 0;
  const hIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount/i.test(c)));
  if (hIdx >= 0) {
    const h = rows[hIdx].map((c) => c.toLowerCase());
    const iDate = findCol(h, /^transaction date$/, /^date$/, /effective/, /date/);
    const iAmt = findCol(h, /^amount$/, /transaction amount/, /amount/);
    const iBal = findCol(h, /balance/);
    const iDesc = findCol(h, /desc/, /narrative/, /details/);
    const iRef = findCol(h, /^reference$/, /ref/, /cheque/);
    for (const r of rows.slice(hIdx + 1)) {
      const date = parseFnbDate(r[iDate] || "", today.getFullYear());
      const amount = parseFnbAmount(r[iAmt] || "");
      if (!date || amount === null || amount === 0) { skipped++; continue; }
      lines.push({ date, amount, description: (iDesc >= 0 ? r[iDesc] : "") || "", reference: iRef >= 0 && r[iRef] ? r[iRef] : null, balance: iBal >= 0 ? parseFnbAmount(r[iBal] || "") : null });
    }
    return { lines, account, format: "header", skipped };
  }
  // CSV Date Number: A=statement date DD/MM/CCYY, B=stmt no, C=narrative, D=cheque/ref, E=amount, F=txn date DD/MM, G=balance
  for (const r of rows) {
    const sd = r[0]?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const td = r[5]?.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!sd || !td || r.length < 7) { skipped++; continue; }
    const sMonth = +sd[2], sYear = +sd[3], tMonth = +td[2];
    const date = ymd(tMonth > sMonth ? sYear - 1 : sYear, tMonth, +td[1]);
    const amount = parseFnbAmount(r[4]);
    if (!date || amount === null || amount === 0) { skipped++; continue; }
    lines.push({ date, amount, description: r[2] || "", reference: r[3] || null, balance: parseFnbAmount(r[6]) });
  }
  return { lines, account, format: lines.length ? "date-number" : "unknown", skipped };
}

export function summarize(lines: BankLine[]) {
  const s = { count: lines.length, moneyIn: 0, moneyOut: 0, from: null as string | null, to: null as string | null };
  for (const l of lines) {
    if (l.amount > 0) s.moneyIn += l.amount; else s.moneyOut += -l.amount;
    if (!s.from || l.date < s.from) s.from = l.date;
    if (!s.to || l.date > s.to) s.to = l.date;
  }
  s.moneyIn = Math.round(s.moneyIn * 100) / 100;
  s.moneyOut = Math.round(s.moneyOut * 100) / 100;
  return s;
}

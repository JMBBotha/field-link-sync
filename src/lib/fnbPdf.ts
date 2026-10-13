/**
 * FNB PDF statement parser (Johan 13 Oct 2026). Runs in the browser with pdf.js; nothing is uploaded.
 * Produces the same BankLine format as fnbCsv.ts so preview, dedup (import_bank_lines) and matching are unchanged.
 * Layout: "DD Mon  Description  [reference]  Amount[ Cr]  Balance[ Cr]  [accrued charges]".
 * Amounts without "Cr" are debits; balances without "Cr" are overdrawn. The year comes from "Statement Period".
 * Every line is checked against the running balance (opening -> each line -> closing); any mismatch blocks import.
 */
import type { BankLine } from "./fnbCsv";

export interface PdfParseResult {
  lines: BankLine[];
  account: string | null;
  format: "pdf";
  skipped: number;
  opening: number | null;
  closing: number | null;
  balanceOk: boolean;
  balanceProblems: string[];
  periodFrom: string | null;
  periodTo: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const AMT = "(\\d{1,3}(?:,\\d{3})*\\.\\d{2})";
const num = (s: string) => Number(s.replace(/,/g, ""));
const r2 = (n: number) => Math.round(n * 100) / 100;

const TXN = new RegExp(`^(\\d{1,2}) ([A-Z][a-z]{2})\\s+(.*?)\\s+${AMT}( Cr)?\\s+${AMT}( Cr)?(?:\\s+(\\d{1,3}(?:,\\d{3})*\\.\\d{2}))?\\s*$`);

function signedBal(line: string, label: string): number | null {
  const m = line.match(new RegExp(`${label}\\s+${AMT}\\s*(Cr|Dr)?`, "i"));
  if (!m) return null;
  return (m[2] && m[2].toLowerCase() === "dr" ? -1 : 1) * num(m[1]);
}

/** Parse text lines (one per visual row; columns separated by 2+ spaces). */
export function parseFnbStatementLines(rows: string[]): PdfParseResult {
  let account: string | null = null, opening: number | null = null, closing: number | null = null;
  let pFrom: { y: number; m: number } | null = null, pTo: { y: number; m: number } | null = null;
  let periodFrom: string | null = null, periodTo: string | null = null;
  for (const raw of rows) {
    const l = raw.replace(/\s+/g, " ");
    if (!account) { const m = l.match(/Account\s*:\s*(\d{8,})/i); if (m) account = `FNB ..${m[1].slice(-4)}`; }
    if (opening === null) opening = signedBal(l, "Opening Balance");
    if (closing === null) closing = signedBal(l, "Closing Balance");
    if (!pFrom) {
      const m = l.match(/Statement Period\s*:\s*(\d{1,2}) ([A-Za-z]+) (\d{4}) to (\d{1,2}) ([A-Za-z]+) (\d{4})/i);
      if (m) {
        const m1 = MONTHS[m[2].slice(0, 3).toLowerCase()], m2 = MONTHS[m[5].slice(0, 3).toLowerCase()];
        if (m1 && m2) {
          pFrom = { y: +m[3], m: m1 }; pTo = { y: +m[6], m: m2 };
          periodFrom = `${m[3]}-${pad(m1)}-${pad(+m[1])}`; periodTo = `${m[6]}-${pad(m2)}-${pad(+m[4])}`;
        }
      }
    }
  }
  const lines: BankLine[] = [];
  const problems: string[] = [];
  let skipped = 0;
  let bal = opening;
  for (const raw of rows) {
    const m = raw.trim().match(TXN);
    if (!m) continue;
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) { skipped++; continue; }
    const year = pFrom && pTo ? (pFrom.y !== pTo.y && mo >= pFrom.m && mo > pTo.m ? pFrom.y : pTo.y) : new Date().getFullYear();
    const date = `${year}-${pad(mo)}-${pad(+m[1])}`;
    const amount = r2((m[5] ? 1 : -1) * num(m[4]));
    const balance = r2((m[7] ? 1 : -1) * num(m[6]));
    const parts = m[3].split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const description = (parts.length > 1 ? parts.slice(0, -1) : parts).join(" ");
    const reference = parts.length > 1 ? parts[parts.length - 1] : null;
    if (bal !== null && Math.abs(bal + amount - balance) > 0.005) problems.push(`${date} ${description}: expected balance ${r2(bal + amount).toFixed(2)}, statement shows ${balance.toFixed(2)}`);
    bal = balance;
    if (amount === 0) { skipped++; continue; }
    lines.push({ date, amount, description, reference, balance });
  }
  if (opening === null) problems.push("Opening balance not found");
  if (closing === null) problems.push("Closing balance not found");
  else if (bal !== null && Math.abs(bal - closing) > 0.005) problems.push(`Last balance ${bal.toFixed(2)} does not equal closing balance ${closing.toFixed(2)}`);
  if (!lines.length) problems.push("No transactions found");
  return { lines, account, format: "pdf", skipped, opening, closing, balanceOk: problems.length === 0, balanceProblems: problems.slice(0, 5), periodFrom, periodTo };
}

interface Item { str: string; x: number; y: number; w: number }

/** Group pdf.js text items into visual rows; a horizontal gap > 6pt becomes a column break ("  "). */
export function itemsToRows(items: Item[]): string[] {
  const rows: Item[][] = [];
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - it.y) <= 2.5) row.push(it); else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let s = "", end = -Infinity;
    for (const it of row) {
      if (s) s += it.x - end > 6 ? "  " : (s.endsWith(" ") || it.str.startsWith(" ") ? "" : " ");
      s += it.str; end = it.x + it.w;
    }
    return s.replace(/[ ]{3,}/g, "  ").trim();
  });
}

export class PdfPasswordError extends Error { constructor(public wrong: boolean) { super(wrong ? "Wrong password" : "Password needed"); } }

/** Extract rows from a PDF (ArrayBuffer). Throws PdfPasswordError when a password is needed or wrong. */
export async function extractPdfRows(data: ArrayBuffer, password?: string, pdfjs?: any): Promise<string[]> {
  const lib = pdfjs ?? (await import("pdfjs-dist"));
  if (!pdfjs) lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
  let doc: any;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(data), password: password || undefined }).promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new PdfPasswordError(e.code === 2);
    throw e;
  }
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    out.push(...itemsToRows(tc.items.filter((i: any) => "str" in i).map((i: any) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))));
  }
  return out;
}

export async function parseFnbPdf(data: ArrayBuffer, password?: string, pdfjs?: any): Promise<PdfParseResult> {
  return parseFnbStatementLines(await extractPdfRows(data, password, pdfjs));
}

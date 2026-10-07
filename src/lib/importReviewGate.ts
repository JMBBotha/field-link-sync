/**
 * Enforced import review gate (pure logic). Finds rows that need an explicit
 * human decision before an AI price-list import may be written:
 * flagged/OCR-fixed codes, price outliers, possible duplicates and empty pages.
 */
import { sanitizeModelCode } from "@/lib/modelCodeSanitize";

export interface GateRow {
  model_number: string;
  description?: string;
  category?: string;
  unit_type?: string | null;
  product_category?: string | null;
  cost_price: number;
  flags?: string[];
}
export interface ExistingProduct { id: string; product_code: string; cost_price: number | null; description?: string | null }
export interface GatePage { page: number; rows: number }

export type ReviewReason =
  | { kind: "flag"; text: string }
  | { kind: "price"; text: string }
  | { kind: "duplicate"; text: string; existingCode: string };

export interface ReviewItem { index: number; reasons: ReviewReason[]; duplicateOf?: string }

/** OCR look-alikes fixed, then everything non-alphanumeric stripped. */
export const looseCode = (code: string) => sanitizeModelCode(code).code.replace(/[^A-Z0-9]/g, "");

/** Basic model-code shape: 4+ chars with at least one letter and one digit (rejects 'JU', 'JUNE'). */
export const passesBasicModelCode = (code: string) => {
  const c = sanitizeModelCode(code).code.replace(/[^A-Z0-9]/g, "");
  return c.length >= 4 && /[A-Z]/.test(c) && /\d/.test(c);
};

const hasUnreadable = (code: string) => /[^A-Za-z0-9\-/.()+#_\s]/.test(code);

function within1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const groupKey = (r: GateRow) => (r.unit_type || r.product_category || r.category || "General").toLowerCase();

export function buildReviewItems(rows: GateRow[], existing: ExistingProduct[]): ReviewItem[] {
  const byExact = new Map(existing.map((e) => [(e.product_code || "").trim().toUpperCase(), e]));
  const byLoose = new Map<string, ExistingProduct>();
  for (const e of existing) { const k = looseCode(e.product_code || ""); if (k && !byLoose.has(k)) byLoose.set(k, e); }

  const groups = new Map<string, number[]>();
  for (const r of rows) if (r.cost_price > 0) {
    const k = groupKey(r); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r.cost_price);
  }
  const medians = new Map([...groups].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, median(v)]));

  const out: ReviewItem[] = [];
  rows.forEach((r, index) => {
    const reasons: ReviewReason[] = [];
    const code = (r.model_number || "").trim();
    const upper = code.toUpperCase();
    const flags = r.flags || [];

    // (a) flags / corrected or unreadable codes
    const s = sanitizeModelCode(code);
    const ocr = flags.find((f) => f.startsWith("model_code_ocr_fixed:"));
    if (ocr) reasons.push({ kind: "flag", text: `Code corrected: "${ocr.slice("model_code_ocr_fixed:".length)}" → ${s.code}` });
    if (flags.includes("model_code_unreadable") || hasUnreadable(code)) reasons.push({ kind: "flag", text: `Code unreadable: "${code}"` });
    if (s.code !== upper.replace(/\s/g, "") && !ocr) reasons.push({ kind: "flag", text: `Code would clean to: "${code}" → ${s.code}` });
    if (code && !passesBasicModelCode(code)) reasons.push({ kind: "flag", text: `Code "${code}" fails the basic model-code check` });
    if (flags.some((f) => f.startsWith("description_garbled"))) reasons.push({ kind: "flag", text: "Description looks garbled" });

    // (b) price outliers
    const exact = byExact.get(upper);
    if (!(r.cost_price > 0)) reasons.push({ kind: "price", text: "Cost is missing or zero" });
    else {
      const m = medians.get(groupKey(r));
      if (m && r.cost_price > m * 3) reasons.push({ kind: "price", text: `Cost R${r.cost_price.toFixed(2)} is over 3× the group median R${m.toFixed(2)}` });
      if (m && r.cost_price < m / 3) reasons.push({ kind: "price", text: `Cost R${r.cost_price.toFixed(2)} is under ⅓ of the group median R${m.toFixed(2)}` });
      const old = Number(exact?.cost_price) || 0;
      if (old > 0 && Math.abs(r.cost_price - old) / old > 0.3) {
        reasons.push({ kind: "price", text: `Cost changes ${Math.round(((r.cost_price - old) / old) * 100)}% vs catalogue (R${old.toFixed(2)} → R${r.cost_price.toFixed(2)})` });
      }
    }

    // (c) possible duplicates of an existing product with different text
    let dup: ExistingProduct | undefined;
    if (!exact) {
      const lk = looseCode(code);
      dup = lk ? byLoose.get(lk) : undefined;
      if (!dup && lk && (s.lowConfidence || hasUnreadable(code))) {
        dup = existing.find((e) => within1(lk, looseCode(e.product_code || "")));
      }
      if (!dup && lk) {
        dup = existing.find((e) => (hasUnreadable(e.product_code) || sanitizeModelCode(e.product_code).lowConfidence) && within1(lk, looseCode(e.product_code || "")));
      }
    }
    if (dup) reasons.push({ kind: "duplicate", text: `Looks like existing "${dup.product_code}"`, existingCode: dup.product_code });

    if (reasons.length) out.push({ index, reasons, duplicateOf: dup?.product_code });
  });
  return out;
}

export const emptyPages = (pages: GatePage[] | undefined) => (pages || []).filter((p) => p.rows === 0).map((p) => p.page);

/** Pick n distinct random indexes (stable per call). */
export function pickSample(total: number, n = 5, rand = Math.random): number[] {
  const idx = Array.from({ length: total }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, Math.min(n, total)).sort((a, b) => a - b);
}

/** List ex VAT × (1 − discount), 2 decimals. */
export const sampleCost = (listExVat: number, discountPct: number) => Math.round(listExVat * (1 - (discountPct || 0) / 100) * 100) / 100;

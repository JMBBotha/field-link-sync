/**
 * POPIA guard for supplier documents. Pure TS (no Deno APIs) so the browser, the edge function and vitest share it.
 * Only product lines leave the device / reach the AI: a line must start with a product code and carry a quantity,
 * and anything that looks like personal data (names after "customer", addresses, phones, emails, ID numbers) is dropped.
 */
export interface DocLine { line_no: number; description: string; model_number: string | null; qty: number; unit_price_excl: number | null }

const PERSONAL_RE = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,                                // email
  /(\+27|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/,          // SA phone
  /\b\d{13}\b/,                                             // SA ID number
  /\b(customer|ship-?to|bill-?to|deliver(y)? to|sold to|attention|attn|contact|signature|name:|address|postal|street|str\b|road|avenue|drive|suite|private bag|apt|unit no|building|mobile|tel|phone|fax|e-?mail|vat reg|company reg|salesperson|picked by|bank|account)\b/i,
  /\b\d{4}\s+[A-Z][a-z]+/,                                  // postcode + town
];
const CODE_RE = /^[A-Z0-9][A-Z0-9./-]{2,24}$/i;
const hasLetterAndDigit = (s: string) => /[A-Z]/i.test(s) && /\d/.test(s);
const MONEY = /^R?\s?-?\d{1,3}(?:[ ,]?\d{3})*(?:[.,]\d{2})$/;

export function looksPersonal(line: string) { return PERSONAL_RE.some((re) => re.test(line)); }

/** Keep only product rows from text lines (pdf text layer). Returns trimmed lines safe to send. */
export function productLinesOnly(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\s+$/g, "")).filter((l) => {
    const t = l.trim();
    if (!t || looksPersonal(t) || /\b(sub-?total|total|shipment no|invoice no|order no|page \d)\b/i.test(t)) return false;
    const first = t.split(/\s{1,}/)[0];
    if (!CODE_RE.test(first) || !hasLetterAndDigit(first)) return false;
    if (/^(FWA-|INV|PO|SO|DN)[-\d]/i.test(first) && !/\s(each|ea|pcs|unit|m|kg)\s/i.test(t)) return false; // doc numbers
    return /\s\d+(?:[.,]\d+)?\s*(?:$|\s)/.test(t + " ");   // has a quantity-like number
  }).map((l) => l.trim().replace(/\s{2,}/g, "  "));
}

/** Local parse of the common "CODE  description  [location]  UOM  qty  [unit price]  [total]" layout. */
export function parseLinesLocally(lines: string[]): DocLine[] {
  const out: DocLine[] = [];
  for (const l of productLinesOnly(lines)) {
    const cols = l.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const code = cols[0].split(/\s+/)[0];
    const nums = cols.slice(1).map((c) => c.replace(/^R\s?/, "")).filter((c) => /^-?\d[\d ,]*(?:[.,]\d+)?$/.test(c));
    let qty: number | null = null; let price: number | null = null;
    const toN = (s: string) => Number(s.replace(/ /g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    if (nums.length === 1) qty = toN(nums[0]);
    else if (nums.length >= 2) {
      const qIdx = nums.findIndex((n) => !MONEY.test(n));
      qty = toN(nums[qIdx >= 0 ? qIdx : 0]);
      const money = nums.filter((n, i) => i !== (qIdx >= 0 ? qIdx : 0));
      if (money.length) price = toN(money[0]);
    }
    if (qty == null || !(qty > 0)) continue;
    const desc = cols.slice(1).filter((c) => !nums.includes(c.replace(/^R\s?/, "")) && !/^(each|ea|pcs|unit|m|kg|roll|box)$/i.test(c) && !/warehouse|store|branch/i.test(c)).join(" ");
    out.push({ line_no: out.length + 1, description: desc || code, model_number: code, qty, unit_price_excl: price });
  }
  return out;
}

/** Validate AI output: product fields only, sane numbers, no personal data smuggled into descriptions. */
export function cleanExtracted(raw: unknown): DocLine[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.lines) ? (raw as any).lines : [];
  const out: DocLine[] = [];
  for (const r of arr) {
    const qty = Number(r?.qty ?? r?.quantity);
    if (!(qty > 0 && qty < 100000)) continue;
    const model = String(r?.model_number ?? r?.code ?? "").trim().slice(0, 40) || null;
    let desc = String(r?.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (looksPersonal(desc)) desc = "";
    if (!model && !desc) continue;
    const p = r?.unit_price_excl ?? r?.unit_price ?? null;
    const price = p == null || p === "" ? null : Number(String(p).replace(/[R\s,]/g, ""));
    out.push({ line_no: out.length + 1, description: desc || model || "", model_number: model,
      qty, unit_price_excl: price != null && Number.isFinite(price) && price >= 0 && price < 10_000_000 ? price : null });
  }
  return out;
}

/** Per-page parse that drops repeated copies (e.g. "Warehouse Document" + "Customer Document" of the same shipment). */
export function parsePagesLocally(pages: string[][]): DocLine[] {
  const seen = new Set<string>(); const out: DocLine[] = [];
  for (const p of pages) {
    const rows = parseLinesLocally(p);
    const sig = rows.map((r) => `${r.model_number}|${r.qty}|${r.unit_price_excl}`).join(";");
    if (!rows.length || seen.has(sig)) continue;
    seen.add(sig);
    for (const r of rows) out.push({ ...r, line_no: out.length + 1 });
  }
  return out;
}

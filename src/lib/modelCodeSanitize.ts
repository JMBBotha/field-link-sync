/**
 * Model-code sanitiser for AI/OCR price-list imports.
 * Fixes known OCR confusions ('<' → 'K', Greek/Cyrillic look-alikes → Latin),
 * uppercases and strips spaces. Every fix is FLAGGED (never silent) so staff can
 * check the code against the PDF; unreadable characters are kept and flagged.
 */

const LOOKALIKE: Record<string, string> = {
  // OCR punctuation confusions
  "<": "K",
  // Greek capitals
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M",
  "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X", "Ϋ": "Y",
  // Greek lowercase (uppercased later anyway)
  "α": "A", "β": "B", "ε": "E", "ι": "I", "κ": "K", "ν": "V", "ο": "O", "ρ": "P",
  "τ": "T", "υ": "Y", "χ": "X",
  // Cyrillic
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P",
  "С": "C", "Т": "T", "Х": "X", "У": "Y", "а": "A", "е": "E", "о": "O", "р": "P",
  "с": "C", "х": "X", "у": "Y",
};

const ALLOWED = /^[A-Z0-9\-/.()+#_]+$/;

export interface SanitizedCode {
  code: string;
  /** true when anything was changed beyond case/spaces, or is still unreadable */
  lowConfidence: boolean;
  flags: string[];
}

export function sanitizeModelCode(raw: string | null | undefined): SanitizedCode {
  const original = String(raw ?? "");
  const flags: string[] = [];
  let fixed = false;
  let out = "";
  // NFD splits accents off (Ύ → Υ + ´) so the base letter maps cleanly.
  for (const ch of original.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) {
    if (/\s/.test(ch)) continue;
    const mapped = LOOKALIKE[ch];
    if (mapped) { out += mapped; fixed = true; continue; }
    out += ch;
  }
  out = out.toUpperCase();
  if (fixed) flags.push(`model_code_ocr_fixed:${original.trim()}`);
  if (out && !ALLOWED.test(out)) flags.push("model_code_unreadable");
  return { code: out, lowConfidence: flags.length > 0, flags };
}

/** Text that came out of the PDF text layer as gibberish (bad font encoding). */
export function looksGarbled(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 20) return false;
  if (/[\u0370-\u03ff\u0400-\u04ff]/.test(t)) return true; // Greek/Cyrillic in an English list
  const chars = t.replace(/\s/g, "");
  const odd = (chars.match(/[^\x21-\x7E\u00A0-\u00FF]/g) || []).length;
  if (chars.length > 0 && odd / chars.length > 0.03) return true;
  const words = t.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length >= 5) {
    // "hI", "wERsonal" — lowercase directly followed by uppercase inside a word
    const weird = words.filter((w) => /^[a-z]+[A-Z]/.test(w) && !/^[a-z]{1,2}[A-Z]{2,}\d/.test(w)).length;
    if (weird / words.length > 0.08) return true;
  }
  return false;
}

/** Round money to 2 decimals. */
export const money2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

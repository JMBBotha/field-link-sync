import { spokenRand, numberToWords } from "./numberSpeech.ts";

/**
 * Money / BTU / refs → natural speech, so TTS never reads digits one by one.
 *
 * Idempotence: text already produced by the client speech formatter
 * (src/lib/mandy/speech.ts) must pass through unchanged:
 *  - rand strings with space-grouped thousands ("R12 763") are left as-is;
 *  - rand strings already spelled with cents ("R9 738 and 26 cents") are left as-is;
 *  - spaced-out quote numbers ("Q 2026 0 0 1 4") contain no convertible pattern.
 */
export function toSpeech(text: string): string {
  let t = text;
  t = t.replace(/R\s?(\d{1,3}(?:[  ,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g, (_m, num: string) => {
    // Already formatted by the client speech pass (space-grouped thousands) → keep.
    if (/[  ]/.test(num)) return _m;
    let s = num;
    // "17,825.22" or "17825,22"
    if (/,\d{1,2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/,(\d{1,2})$/, ".$1");
    s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? (spokenRand(n) ?? _m) : _m;
  });
  t = t.replace(/(\d[\d ,]*)\s?BTU/gi, (_m, n: string) => `${numberToWords(Number(n.replace(/[ ,]/g, "")))} BTU`);
  t = t.replace(/\b(\d+)\s?K\b/g, (_m, n: string) => `${numberToWords(Number(n))} thousand BTU`);
  t = t.replace(/\bQ-(\d{4})-(\d+)\b/g, (_m, y: string, n: string) => `Q ${y.split("").join(" ")} ${n.split("").join(" ")}`);
  t = t.replace(/\bexcl\.?\s*VAT\b/gi, "excluding VAT").replace(/\bincl\.?\s*VAT\b/gi, "including VAT");
  t = t.replace(/(\d+(?:\.\d+)?)\s?m\b/g, (_m, n: string) => `${n} metre${n === "1" ? "" : "s"}`);
  return t;
}

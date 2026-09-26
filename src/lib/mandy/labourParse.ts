/**
 * Deterministic single labour command → set_labour_hours args, no model needed.
 * "add 3 hours labour to the lounge", "set labour to 4 hours",
 * "make the labour in bedroom 1 four hours", "labour 2 hours at R750 an hour".
 */
export interface LabourCommand { area?: string; hours: number; mode: "add" | "set"; rate?: number }

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  a: 1, an: 1,
};
const NUM = String.raw`(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an?)(\s+and\s+a\s+half)?`;
const toNum = (n: string, half?: string) => {
  const v = WORDS[n.toLowerCase()] ?? Number(n.replace(",", "."));
  return Number.isFinite(v) ? v + (half ? 0.5 : 0) : NaN;
};
const cleanArea = (s?: string) => {
  const a = (s || "").trim().replace(/[.!?,]+$/, "").replace(/^(the|my)\s+/i, "").trim();
  return a || undefined;
};

export function parseLabourCommand(text: string): LabourCommand | null {
  let t = String(text || "").trim().replace(/[.!?]+$/, "");
  if (!/\blabou?r\b/i.test(t) || !/\b(hours?|hrs?)\b/i.test(t)) return null;
  // Single clause only; multi-edit goes to the plan parser.
  if (/\b(kit|samsung|unit|note)\b/i.test(t) || /,|;/.test(t)) return null;

  let rate: number | undefined;
  const rm = t.match(/\s+at\s+R?\s*(\d+(?:[.,]\d+)?)\s*(?:rand)?\s*(?:an?\s+hour|per\s+hour|\/\s*h(?:ou)?r?)?\s*$/i);
  if (rm) { rate = Number(rm[1].replace(",", ".")); t = t.slice(0, rm.index).trim(); }

  const H = String.raw`${NUM}\s*(?:hours?|hrs?)`;
  let m: RegExpMatchArray | null;
  let r: LabourCommand | null = null;
  if ((m = t.match(new RegExp(String.raw`^add\s+${H}\s*(?:of\s+)?labou?r(?:\s+(?:to|in|for|on)\s+(.+))?$`, "i")))) {
    r = { hours: toNum(m[1], m[2]), mode: "add", area: cleanArea(m[3]) };
  } else if ((m = t.match(new RegExp(String.raw`^(?:set|make|change)\s+(?:the\s+)?labou?r(?:\s+(?:in|for|on)\s+(.+?))?\s+(?:to\s+)?${H}$`, "i")))) {
    r = { hours: toNum(m[2], m[3]), mode: "set", area: cleanArea(m[1]) };
  } else if ((m = t.match(new RegExp(String.raw`^labou?r(?:\s+(?:in|for|on)\s+(.+?))?\s+${H}(?:\s+(?:in|for|on|to)\s+(.+))?$`, "i")))) {
    r = { hours: toNum(m[2], m[3]), mode: "set", area: cleanArea(m[1] || m[4]) };
  }
  if (!r || !(r.hours >= 0)) return null;
  if (!r.area) delete r.area;
  if (rate != null && rate > 0) r.rate = rate;
  return r;
}

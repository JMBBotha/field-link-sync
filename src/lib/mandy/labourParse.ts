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
  } else if ((m = t.match(new RegExp(String.raw`^(?:set|make|change)\s+(?:the\s+)?(.+?)\s+labou?r\s+(?:to\s+)?${H}$`, "i")))) {
    r = { hours: toNum(m[2], m[3]), mode: "set", area: cleanArea(m[1]) };
  } else if ((m = t.match(new RegExp(String.raw`^labou?r(?:\s+(?:in|for|on)\s+(.+?))?\s+${H}(?:\s+(?:in|for|on|to)\s+(.+))?$`, "i")))) {
    r = { hours: toNum(m[2], m[3]), mode: "set", area: cleanArea(m[1] || m[4]) };
  }
  if (!r || !(r.hours >= 0)) return null;
  if (!r.area) delete r.area;
  if (rate != null && rate > 0) r.rate = rate;
  return r;
}

export type LabourIntent =
  | { action: "set_labour_hours"; args: Partial<LabourCommand> }
  | { action: "remove_labour"; args: { area?: string; all?: boolean } }
  | { action: "read_labour"; args: Record<string, never> };

/** Any single labour utterance → the labour action to run, or null. */
export function parseLabourIntent(text: string): LabourIntent | null {
  const t = String(text || "").trim().replace(/[.!?]+$/, "");
  if (!/\blabou?r\b/i.test(t) || /,|;/.test(t) || /\b(kit|samsung|unit|note)\b/i.test(t)) return null;
  let m: RegExpMatchArray | null;
  if (/^(?:what|how much|which|read|list|show)\b.*\blabou?r\b/i.test(t) || /^labou?r\s+on\s+(?:this|the)\s+quote$/i.test(t)) {
    return { action: "read_labour", args: {} };
  }
  if ((m = t.match(/^(?:remove|delete|drop|take\s+off|clear)\s+(all\s+)?(?:of\s+)?(?:the\s+)?labou?r(?:\s+(?:from|in|on|off)\s+(.+))?$/i))) {
    const area = cleanArea(m[2]);
    if (m[1] || (area && /^(all|every|everywhere|all areas|the quote|this quote)$/i.test(area))) return { action: "remove_labour", args: { all: true } };
    return { action: "remove_labour", args: area ? { area } : {} };
  }
  if ((m = t.match(/^(?:set|make|change)\s+(?:the\s+)?(?:(.+?)\s+)?labou?r\s+rate(?:\s+(?:in|for|on)\s+(.+?))?\s+(?:to\s+)?R?\s*(\d+(?:[.,]\d+)?)\s*(?:rand)?(?:\s+(?:an?|per)\s+hour)?$/i))) {
    const area = cleanArea(m[1] || m[2]);
    return { action: "set_labour_hours", args: { rate: Number(m[3].replace(",", ".")), mode: "set", ...(area ? { area } : {}) } };
  }
  const c = parseLabourCommand(t);
  return c ? { action: "set_labour_hours", args: c } : null;
}

/** Model called an unregistered labour-ish tool → the closest real labour action. */
export function mapLabourTool(name: string, args: Record<string, any>): { action: string; args: Record<string, any> } | null {
  if (!/labou?r/i.test(name)) return null;
  const a: Record<string, any> = { ...args };
  if (/remove|delete|clear|drop/i.test(name)) return { action: "remove_labour", args: { ...(a.area ? { area: a.area } : {}), ...(a.all ? { all: true } : {}) } };
  if (/read|list|get|show|what/i.test(name)) return { action: "read_labour", args: {} };
  const rate = a.rate ?? a.hourly_rate ?? a.rate_per_hour;
  return { action: "set_labour_hours", args: { ...(a.area ? { area: a.area } : {}), ...(a.hours != null ? { hours: a.hours } : {}), ...(rate != null ? { rate } : {}), mode: a.mode === "add" ? "add" : "set" } };
}

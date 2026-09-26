import type { MandyResult } from "./actions";

const CLAIM = /\b(added|set|changed|updated|moved|removed|created|renamed|increased|decreased)\b[\s\S]*?(\bhours?\b|\bR\s?\d)/i;
export const HONESTY_HINT = "Say it again with the area, e.g. add 3 hours labour to Bedroom 1.";

/** Replace a claimed change when no write actually succeeded this turn. */
export function guardClaimedChange(final: string, results: MandyResult[], writes: boolean[]): string {
  const anyWrite = results.some((r, i) => writes[i] && r.ok && !r.choices?.length && !r.confirm);
  if (anyWrite || !CLAIM.test(final)) return final;
  const failed = results.find((r, i) => writes[i] && !r.ok);
  return `I didn't change anything. ${failed?.message || HONESTY_HINT}`;
}

const QUOTE_TOOL_RE = /labou?r|area|item|kit|qty|price|note|quote|plan|undo/i;
/** Honest reply for a tool the page doesn't offer, saying what IS possible. */
export function unknownToolMessage(name: string, quoteOpen: boolean): string {
  if (!quoteOpen && QUOTE_TOOL_RE.test(name)) return "I can't do that here — open the quote first.";
  return quoteOpen
    ? "I can't do that. On this quote I can add or remove items, areas, labour and notes, change quantities, prices and kit lengths, and read the total or the labour."
    : "I can't do that here. I can open quotes, invoices, clients, the calendar and the live map.";
}

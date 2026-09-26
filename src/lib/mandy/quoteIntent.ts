/**
 * Deterministic quote-edit pre-route (no model): clear the quote, remove/change a
 * line, add/rename/remove areas. Labour phrases are handled by parseLabourIntent first.
 * Pure — the dock calls the registered handler with the parsed args.
 */
export type QuoteIntent =
  | { action: "clear_quote"; args: { include_areas?: boolean } }
  | { action: "remove_item"; args: { item: string } }
  | { action: "set_qty"; args: { item: string; qty: number } }
  | { action: "add_area"; args: { name: string } }
  | { action: "rename_area"; args: { area: string; new_name: string } }
  | { action: "cancel_pending"; args: Record<string, never> };

const QTY: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const clean = (s: string) => s.trim().replace(/[.!?,]+$/, "").trim();

/** Bare cancel words — only meaningful while a Confirm card is pending. */
export const CANCEL_RE = /^(no|nope|cancel|clear|start over|start again|forget it|never ?mind|scrap (?:that|it)|discard|stop)$/i;

export function isClearQuote(t: string): { include_areas?: boolean } | null {
  const s = t.toLowerCase();
  const hit =
    /\b(?:clear|empty|wipe|clean|reset)\s+(?:out\s+)?(?:the\s+|this\s+)?(?:whole\s+|entire\s+)?quote\b/.test(s) ||
    /\b(?:remove|delete|clear)\s+everything\b/.test(s) ||
    /^(?:please\s+)?start\s+(?:over|again)$/.test(s) ||
    /\bremove\s+all\s+(?:the\s+)?(?:areas|rooms)\b/.test(s);
  if (!hit) return null;
  const areas = /\b(?:and|plus|with)\s+(?:the\s+|all\s+(?:the\s+)?)?(?:rooms|areas)\b|\b(?:rooms|areas)\s+(?:too|as well)\b|\bremove\s+all\s+(?:the\s+)?(?:areas|rooms)\b/.test(s);
  return areas ? { include_areas: true } : {};
}

export function parseQuoteIntent(text: string, o: { pendingCard?: boolean } = {}): QuoteIntent | null {
  const t = clean(String(text || ""));
  if (!t) return null;
  if (o.pendingCard && CANCEL_RE.test(t)) return { action: "cancel_pending", args: {} };
  if (/,|;|\band then\b/i.test(t) && !isClearQuote(t)) return null; // multi-clause → plan parser / model
  const c = isClearQuote(t);
  if (c) return { action: "clear_quote", args: c };
  if (/\b(labou?r|notes?|price|rate)\b/i.test(t)) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:add|create|make)\s+(?:a\s+new\s+|an?\s+|new\s+)?(?:area|room)\s+(?:called|named)?\s*(.+)$/i))) return { action: "add_area", args: { name: clean(m[1]) } };
  if ((m = t.match(/^rename\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i))) return { action: "rename_area", args: { area: clean(m[1]), new_name: clean(m[2]) } };
  if ((m = t.match(/^(?:change|make|set)\s+(?:the\s+)?(.+?)\s+(?:quantity\s+)?to\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i))) {
    const qty = QTY[m[2].toLowerCase()] ?? Number(m[2]);
    if (qty > 0) return { action: "set_qty", args: { item: clean(m[1]), qty } };
  }
  if ((m = t.match(/^(?:please\s+)?(?:remove|delete|take\s+out|take\s+off|drop|get\s+rid\s+of)\s+(.+)$/i))) return { action: "remove_item", args: { item: clean(m[1]) } };
  return null;
}

/* ───── clear_quote helpers ───── */

const REFUSE = /^(accepted|invoiced|paid|partially_paid|converted|won|completed)$/i;

/** null = may clear; otherwise the spoken refusal. */
export function clearRefusal(quoteNumber: string, status: string | null | undefined, f: { depositPaid?: boolean; hasJob?: boolean } = {}): string | null {
  const st = String(status || "draft").toLowerCase();
  const what = f.depositPaid || /paid/.test(st) ? "paid" : st === "invoiced" ? "invoiced" : REFUSE.test(st) || f.hasJob ? "accepted" : st !== "draft" ? st : null;
  return what ? `I can't clear ${quoteNumber} – it's already ${what}. Make a revision instead.` : null;
}

export interface ClearCounts { items: number; labour: number; kits: number; areasRemoved: number }

export function clearSummary(quoteNumber: string, c: ClearCounts): string {
  const rooms = c.areasRemoved ? ` and ${c.areasRemoved} room name${c.areasRemoved === 1 ? "" : "s"}` : "";
  return `Remove all ${c.items} item${c.items === 1 ? "" : "s"}, ${c.labour} labour row${c.labour === 1 ? "" : "s"} and ${c.kits} kit${c.kits === 1 ? "" : "s"}${rooms} from ${quoteNumber}? ${c.areasRemoved ? "Rooms are removed too." : "Room names are kept."}`;
}

/** Areas to delete when clearing "with the rooms": everything except the default (General, else the first). */
export function areasToRemove(areas: { id: string; name: string; sort_order?: number | null }[]): string[] {
  if (areas.length <= 1) return [];
  const sorted = [...areas].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const keep = sorted.find((a) => /^general$/i.test(a.name.trim())) || sorted[0];
  return sorted.filter((a) => a.id !== keep.id).map((a) => a.id);
}

export const CLEARED_MESSAGE = "Cleared the quote, R0. Say undo to bring it back.";

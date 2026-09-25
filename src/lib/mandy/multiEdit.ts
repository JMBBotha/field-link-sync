/**
 * Deterministic multi-edit pre-parser. "Bedroom 3: add a 12K Samsung with 3 m
 * kit and 2 hours labour" → ordered plan steps, without asking the model.
 * Returns null unless the sentence holds 2+ edit clauses.
 */
import type { PlanStep } from "@/lib/mandy/quoteEdits";

const tidy = (s: string) => s.trim().replace(/[.!?]+$/, "").replace(/^(the|my)\s+/i, "").trim();
const STOP_AT = /\s+(?:with|and|plus)\s+|,|\s+(?:to|in|into|on)\s+(?:the\s+)?/i;

export function parseMultiEdit(text: string): PlanStep[] | null {
  let t = String(text || "").trim().replace(/[.!?]+$/, "");
  if (!t) return null;
  let area = "";
  const pre = t.match(/^\s*([a-z][\w '\-]{0,40}?)\s*:\s*(.+)$/i);
  if (pre) { area = tidy(pre[1]); t = pre[2]; }

  const kitM = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metres?|meters?)\b\s*(?:of\s+)?(?:piping\s+|pipe\s+)?kit\b/i)
    || t.match(/\bkit\s+(?:of|at|to)?\s*(\d+(?:[.,]\d+)?)\s*(?:m|metres?|meters?)\b/i);
  const labM = t.match(/(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b\s*(?:of\s+)?labou?r\b/i)
    || t.match(/\blabou?r\s+(?:of\s+)?(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const prodM = t.match(/\badd\s+(?:an?\s+|one\s+|(\d+)\s*(?:x\s*)?)?(.+)$/i);
  let product = "";
  let qty = 1;
  if (prodM) {
    const rest = prodM[2];
    const cut = rest.split(STOP_AT)[0] || "";
    const cand = tidy(cut);
    // The "product" must not itself be the kit/labour clause.
    if (cand && !/^\d+(?:[.,]\d+)?\s*(?:m|metres?|meters?|hours?|hrs?|h)\b/i.test(cand) && !/\b(kit|labou?r|note)\b/i.test(cand)) {
      product = cand;
      if (prodM[1]) qty = Number(prodM[1]);
    }
  }
  if (!area) {
    const to = t.match(/\b(?:to|in|into|on)\s+(?:the\s+)?([a-z][\w '\-]*?)(?=\s+(?:with|and|plus)\b|,|$)/i);
    if (to && !/\b(kit|labou?r|quote)\b/i.test(to[1])) area = tidy(to[1]);
  }

  const clauses = [product, kitM, labM].filter(Boolean).length;
  if (clauses < 2) return null;
  const n = (s: string) => Number(s.replace(",", "."));
  const steps: PlanStep[] = [];
  if (area) steps.push({ action: "add_area", args: { name: area } });
  if (product) steps.push({ action: "add_item_to_area", args: { ...(area ? { area } : {}), query: product, ...(qty > 1 ? { quantity: qty } : {}) } });
  if (kitM) steps.push({ action: "set_kit_length", args: { ...(area ? { area } : {}), metres: n(kitM[1]) } });
  if (labM) steps.push({ action: "set_labour_hours", args: { area, hours: n(labM[1]), mode: "add" } });
  return steps;
}

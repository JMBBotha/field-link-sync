/**
 * One fuzzy resolver for every Mandy item edit (remove, qty, price, move, kit length).
 * Pure: no I/O. Matches name, product code, description, brand/supplier, aliases,
 * kind (kit / labour / unit) and normalised sizes (12000 = 12K = twelve thousand = 12k btu).
 */
import { isLabourItem } from "@/lib/labour";

export interface RItem {
  id: string; area_id: string | null; parent_item_id?: string | null; item_name: string;
  item_number?: string | null; description?: string | null; supplier?: string | null;
  item_type?: string | null; is_bundle?: boolean | null; metadata?: any; sort_order?: number | null;
  quantity?: number | null; length?: number | null; unit_price?: number | null; total_price?: number | null;
}
export interface RArea { id: string; name: string; sort_order?: number | null }

const NUMS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", eighteen: "18", twenty: "20", thirty: "30", "twenty four": "24", "thirty six": "36",
  "forty eight": "48", sixty: "60",
};
const SIZES = new Set(["9", "12", "18", "24", "30", "36", "48", "60"]);
const FILLER = new Set(["the", "a", "an", "unit", "one", "please", "out", "it", "that", "this", "line", "item", "my", "of", "btu", "aircon", "air", "con", "ac"]);

/** Lowercase, spoken numbers → digits, sizes → "12k", "inverter" → "inv". */
export function normText(s: string, opts: { bareSizes?: boolean } = {}): string {
  let t = ` ${String(s || "").toLowerCase().replace(/[^a-z0-9/.\- ]+/g, " ").replace(/[-/]/g, " ")} `;
  t = t.replace(/\b(twenty four|thirty six|forty eight)\b/g, (m) => NUMS[m]);
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|thirty|sixty)\s+thousand\b/g, (_m, w) => `${NUMS[w]}000`);
  t = t.replace(/\b(\d{1,2})\s?000\b(?:\s*btu\b)?/g, "$1k").replace(/\b(\d{1,2})\s*k\b(?:\s*btu\b)?/g, "$1k");
  t = t.replace(/\b0(\d)k\b/g, "$1k");
  t = t.replace(/\binverter\b/g, "inv").replace(/\blabor\b/g, "labour").replace(/\bpipes?\b|\bpiping\b/g, "piping");
  if (opts.bareSizes) t = t.replace(/\b(\d{1,2})\b/g, (m, n) => (SIZES.has(n) ? `${n}k` : m));
  return t.replace(/\s+/g, " ").trim();
}

/** "bedroom one" → "bedroom 1" (for area names). */
export function normArea(s: string): string {
  return String(s || "").toLowerCase().replace(/^(the|my)\s+/, "").replace(/\b(area|room)\b$/, "")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (m) => NUMS[m])
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function findAreaFuzzy<A extends RArea>(areas: A[], name?: string | null): A | null {
  const n = normArea(String(name || ""));
  if (!n) return null;
  return areas.find((a) => normArea(a.name) === n)
    || areas.find((a) => { const an = normArea(a.name); return an.includes(n) || n.includes(an); }) || null;
}

export const isKitItem = (i: RItem) => !!i.is_bundle || /kit/i.test(i.item_type || "") || !!i.metadata?.kit;
export const isLabourRow = (i: RItem) => isLabourItem(i as any);

function blob(i: RItem): string[] {
  const md = i.metadata || {};
  const kind = isLabourRow(i) ? "labour hours" : isKitItem(i) ? "kit piping copper install" : "unit";
  const aliases = Array.isArray(md.search_aliases) ? md.search_aliases.join(" ") : String(md.search_aliases || "");
  const raw = [i.item_name, i.item_number, i.description, i.supplier, md.brand, md.supplier, md.short_name, aliases, i.item_type, kind].filter(Boolean).join(" ");
  return normText(raw).split(" ").filter(Boolean);
}

export type Resolve<T> =
  | { kind: "one"; item: T; area: RArea | null }
  | { kind: "many"; hits: T[]; area: RArea | null }
  | { kind: "none"; area: RArea | null; query: string };

/** Split "the samsung in bedroom one" → { ref: "the samsung", area }. */
export function splitAreaScope<A extends RArea>(ref: string, areas: A[]): { ref: string; area: A | null } {
  const m = String(ref || "").match(/\s+(?:in|from|on|off)\s+(?:the\s+)?(.+)$/i);
  if (m) {
    const a = findAreaFuzzy(areas, m[1]);
    if (a) return { ref: ref.slice(0, m.index).trim(), area: a };
  }
  return { ref: String(ref || ""), area: null };
}

export function resolveItemRef<T extends RItem>(items: T[], areas: RArea[], ref0: string): Resolve<T> {
  const { ref, area } = splitAreaScope(ref0, areas);
  const pool = items.filter((i) => !i.parent_item_id && (!area || i.area_id === area.id));
  const q = normText(ref, { bareSizes: true });
  const exact = pool.filter((i) => normText(i.item_number || "") === q || normText(i.item_name) === q || i.id === ref.trim());
  if (exact.length === 1) return { kind: "one", item: exact[0], area };
  const toks = q.split(" ").filter((w) => w && !FILLER.has(w));
  if (!toks.length) {
    if (area && pool.length === 1) return { kind: "one", item: pool[0], area };
    return area && pool.length ? { kind: "many", hits: pool, area } : { kind: "none", area, query: ref };
  }
  const scored = pool.map((i) => {
    const b = blob(i);
    let s = 0, all = true;
    for (const w of toks) {
      if (b.includes(w)) s += 2;
      else if (w.length >= 3 && b.some((x) => x.startsWith(w))) s += 1.5;
      else all = false;
    }
    return { i, s, all };
  }).filter((x) => x.all);
  if (!scored.length) return { kind: "none", area, query: ref };
  const best = Math.max(...scored.map((x) => x.s));
  const hits = scored.filter((x) => x.s === best).map((x) => x.i);
  return hits.length === 1 ? { kind: "one", item: hits[0], area } : { kind: "many", hits, area };
}

/** "Samsung 12K INV MW (Bedroom 1), 12K piping kit (Bedroom 1), Labour (General, Bedroom 1)". */
export function quoteLinesListing(items: RItem[], areas: RArea[]): string {
  const an = (id: string | null) => areas.find((a) => a.id === id)?.name || "No area";
  const top = items.filter((i) => !i.parent_item_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const lab = top.filter(isLabourRow);
  const parts = top.filter((i) => !isLabourRow(i)).map((i) => `${i.item_name} (${an(i.area_id)})`);
  if (lab.length) parts.push(`Labour (${lab.map((l) => an(l.area_id)).join(", ")})`);
  return parts.join(", ");
}

export function noMatchMessage(query: string, items: RItem[], areas: RArea[]): string {
  const list = quoteLinesListing(items, areas);
  const q = String(query || "").replace(/^(the|a|an)\s+/i, "").trim();
  return list ? `I couldn't find ${q || "that"}. On this quote: ${list}.` : "There are no lines on this quote.";
}

export const chipLabel = (i: RItem, areas: RArea[]) => {
  const a = areas.find((x) => x.id === i.area_id)?.name;
  return `${i.item_name}${a ? ` · ${a}` : ""}`;
};

const ORD: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, fifth: 4, "5th": 4, last: -1 };
const GENERIC = /^(general|default|unassigned|this|that|it|the|this one|that one|)$/;

/**
 * Area words the model sends for "rename it to Lounge": exact/fuzzy name,
 * ordinals ("1st area", "second room"), or generic words ("General",
 * "this area", "the room") which mean the only area. Null when unresolved.
 */
export function resolveAreaWord<A extends RArea>(areas: A[], ref?: string | null): A | null {
  const hit = findAreaFuzzy(areas, ref);
  if (hit) return hit;
  const w = String(ref || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|my|area|room)\b/g, " ").replace(/\s+/g, " ").trim();
  const o = w.match(/^(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)(?:\s+one)?$/) || w.match(/^(?:number\s+)?(\d)$/);
  if (o) {
    const i = o[1] in ORD ? ORD[o[1]] : Number(o[1]) - 1;
    return (i === -1 ? areas[areas.length - 1] : areas[i]) || null;
  }
  if (GENERIC.test(w) && areas.length === 1) return areas[0];
  return null;
}

export type RenameDecision<A> =
  | { kind: "rename"; area: A }
  | { kind: "create" }
  | { kind: "choices"; message: string; choices: { label: string; action: string; args: Record<string, unknown> }[] };

/** rename_area never dead-ends: resolve → only area → create when none → chips. */
export function renameAreaDecision<A extends RArea>(areas: A[], ref: unknown, newName: string): RenameDecision<A> {
  const a = resolveAreaWord(areas, String(ref ?? ""));
  if (a) return { kind: "rename", area: a };
  if (areas.length === 1) return { kind: "rename", area: areas[0] };
  if (!areas.length) return { kind: "create" };
  return {
    kind: "choices",
    message: `Which room should become ${newName}? You have: ${areas.map((x) => x.name).join(", ")}.`,
    choices: areas.map((x) => ({ label: x.name, action: "rename_area", args: { area: x.name, new_name: newName } })),
  };
}

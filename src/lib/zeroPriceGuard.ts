// R0 guard: a named line priced R0 blocks save/send (invoice, proposal, quote).
import { setR0, focusFirstR0, r0Summary, r0CountText, type R0Offender } from "@/lib/r0Highlight";
type T = (t: { title: string; description: string; variant?: "destructive" | "default" }) => unknown;
export const r0Line = (ls: { n?: string | null; p?: unknown }[]) => ls.find((l) => String(l.n ?? "").trim() && !Number(l.p))?.n?.trim() ?? null;
export const r0Msg = (n: string) => `Enter a price for ${n}`;
// Blocked: highlight every offending line (lib/r0Highlight), toast lists area + item names, focus the first field.
const blkAll = (offs: R0Offender[], t: T) => {
  setR0(offs);
  if (!offs.length) return false;
  t({ title: offs.length === 1 ? "Price missing" : r0CountText(offs.length), description: `Enter a price for ${r0Summary(offs)}`, variant: "destructive" });
  focusFirstR0(offs);
  return true;
};
/** Invoice / proposal lines (keyed by index; area = room/area field when the line has one). */
export const r0FormOffenders = (ls: { description?: string | null; rate?: unknown; room?: string | null; room_label?: string | null; area?: string | null }[]): R0Offender[] =>
  ls.flatMap((l, i) => {
    const n = String(l.description ?? "").trim().split("\n")[0];
    if (!n || Number(l.rate)) return [];
    const a = (l.room_label || l.room || l.area || "").trim() || null;
    return [{ key: `row:${i}`, name: n, areaKey: a ? `room:${a}` : null, areaName: a, reason: "price" as const }];
  });
export const blockR0 = (ls: { description?: string | null; rate?: unknown }[], t: T) => blkAll(r0FormOffenders(ls as any), t);
// A bundle item with no live model match sits inside a kit as "Not found: <model> – remap" (lib/bundleResolve.ts): treated as an unpriced line.
const kitNotFound = (ls: { metadata?: any }[]) => {
  for (const l of ls) for (const k of (l?.metadata?.kit?.items ?? []) as any[]) if (String(k?.name ?? "").startsWith("Not found: ")) return String(k.name);
  return null;
};
// A metre line at 0 m is treated like an R0 line (must enter metres).
const zeroMetre = (l: { quantity?: unknown; metadata?: any }) => l?.metadata?.qty_unit === "metre" && !(Number(l.quantity) > 0);
// Not an R0 problem (Johan 2026-10-13): a qty-0 heading line (adds nothing) and labour at R0 (labour included / no labour).
const LABOUR_NAME = /^\s*(labou?r\b|installation\s*fee\b|ac\s+installation\s*$|installation\s*$)|\binstall(ation)?\s+fee\b/i;
const skipR0 = (l: { item_name?: string | null; item_type?: string | null; quantity?: unknown; metadata?: any }) =>
  (l?.metadata?.qty_unit !== "metre" && !(Number(l.quantity) > 0)) ||
  String(l.item_type || "").toLowerCase() === "labour" || !!l?.metadata?.labour || LABOUR_NAME.test(String(l.item_name || ""));
export const r0Quote = (ls: { item_name?: string | null; item_type?: string | null; unit_price?: unknown; quantity?: unknown; parent_item_id?: string | null; metadata?: any }[]) =>
  r0Line(ls.filter((l) => !l.parent_item_id && !skipR0(l)).map((l) => ({ n: l.item_name, p: String(l.item_name ?? "").startsWith("Not found: ") || zeroMetre(l) ? 0 : l.unit_price })))
  ?? kitNotFound(ls);
type QL = Parameters<typeof r0Quote>[0][number] & { id?: string | null; area_id?: string | null };
/** Every offending top-level quote line (same rule as r0Quote), with its area for the red header + toast. */
export const r0QuoteOffenders = (ls: QL[], areaNames: Record<string, string> = {}): R0Offender[] => {
  const out: R0Offender[] = [];
  const area = (l: QL) => ({ areaKey: l.area_id ?? "unassigned", areaName: l.area_id ? areaNames[l.area_id] ?? null : null });
  ls.forEach((l, i) => {
    if (l.parent_item_id || skipR0(l)) return;
    const name = String(l.item_name ?? "").trim();
    if (!name) return;
    const notFound = name.startsWith("Not found: ");
    const metre = zeroMetre(l);
    if (!notFound && !metre && Number(l.unit_price)) return;
    out.push({ key: l.id ?? `row:${i}`, name, ...area(l), reason: notFound ? "notfound" : metre ? "metres" : "price" });
  });
  if (!out.length) {
    for (const [i, l] of ls.entries()) {
      const k = kitNotFound([l]);
      if (k) out.push({ key: l.id ?? `row:${i}`, name: `${String(l.item_name ?? "Kit").trim()} (${k})`, ...area(l), reason: "notfound" });
    }
  }
  return out;
};
export const blockR0Quote = (ls: QL[], t: T, areaNames: Record<string, string> = {}) => blkAll(r0QuoteOffenders(ls, areaNames), t);

// Drafts (Johan 2026-10-21 17:14): a draft save is never blocked by missing prices. The lines are still marked red
// (no jump/focus), and after the save a soft toast says "Saved as draft — N prices missing". Send / PDF / accept / convert stay blocked.
export const markR0Quote = (ls: QL[], areaNames: Record<string, string> = {}) => { const o = r0QuoteOffenders(ls, areaNames); setR0(o); return o; };
export const markR0 = (ls: { description?: string | null; rate?: unknown }[]) => { const o = r0FormOffenders(ls as any); setR0(o); return o; };
export const draftR0Toast = (offs: R0Offender[], t: T) => {
  if (offs.length) t({ title: `Saved as draft — ${r0CountText(offs.length)}`, description: `Still to price before sending: ${r0Summary(offs)}`, variant: "default" });
};

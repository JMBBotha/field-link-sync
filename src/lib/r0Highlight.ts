// R0 highlight (Johan 2026-10-21): when the R0 guard blocks save/send, mark every offending line red,
// mark its area header red with a count (auto-expands), scroll to + focus the first price field,
// and clear a line's red as soon as a valid price is entered.
import { useSyncExternalStore } from "react";

export type R0Reason = "price" | "metres" | "notfound";
export type R0Offender = { key: string; name: string; areaKey: string | null; areaName: string | null; reason: R0Reason };
type State = { lines: Map<string, R0Offender>; areas: Map<string, number> };

let state: State = { lines: new Map(), areas: new Map() };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const build = (lines: Map<string, R0Offender>): State => {
  const areas = new Map<string, number>();
  for (const o of lines.values()) if (o.areaKey) areas.set(o.areaKey, (areas.get(o.areaKey) ?? 0) + 1);
  return { lines, areas };
};

export const r0HintText = (r: R0Reason) => (r === "metres" ? "Enter the metres" : r === "notfound" ? "Pick a product / enter a price" : "Enter a price");
export const r0CountText = (n: number) => `${n} price${n === 1 ? "" : "s"} missing`;

/** Toast text: area names + item names, e.g. "Lounge: Samsung 12K, Copper · Bedroom: Bracket". */
export const r0Summary = (offs: R0Offender[]) => {
  const groups = new Map<string, string[]>();
  for (const o of offs) {
    const a = o.areaName?.trim() || "";
    groups.set(a, [...(groups.get(a) ?? []), o.name]);
  }
  return [...groups.entries()].map(([a, ns]) => (a ? `${a}: ${ns.join(", ")}` : ns.join(", "))).join(" · ");
};

export function setR0(offs: R0Offender[]) {
  state = build(new Map(offs.map((o) => [o.key, o])));
  emit();
}
export function clearR0Line(key: string) {
  if (!state.lines.has(key)) return;
  const next = new Map(state.lines);
  next.delete(key);
  state = build(next);
  emit();
}
export function clearAllR0() {
  if (!state.lines.size) return;
  state = build(new Map());
  emit();
}
/** Call from a price input's onInput/onChange: a valid (> 0) price clears that line's red. */
export const r0PriceInput = (key: string, value: unknown) => { if (Number(value) > 0) clearR0Line(key); };

export function useR0() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);
}

/** Scroll to + focus the first offending field. Waits for collapsed areas to expand. */
export function focusFirstR0(offs: R0Offender[]) {
  if (typeof window === "undefined" || !offs.length) return;
  let tries = 0;
  const go = () => {
    for (const o of offs) {
      const el = document.querySelector<HTMLElement>(`[data-r0-key="${CSS.escape(o.key)}"]`);
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
        return;
      }
    }
    if (++tries < 10) setTimeout(go, 80);
  };
  requestAnimationFrame(() => setTimeout(go, 30));
}

/** Red classes for an offending field / row (Tailwind). */
export const R0_FIELD = "!border-red-500 !bg-red-50 ring-1 ring-red-500 focus-visible:ring-red-500";
export const R0_ROW = "bg-red-50/70";

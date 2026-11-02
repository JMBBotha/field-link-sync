/** Phone quote builder: one segmented row Build quote | Visual PDF | Client view (Johan 2 Nov 14:56).
 * The tab row lives in the builder page; the client view lives inside EstimateBuilder. This tiny store links them. */
import { useSyncExternalStore } from "react";
export type QbViewName = "editor" | "client" | "pricelist";
type S = { external: boolean; view: QbViewName; canPriceList?: boolean };
let s: S = { external: false, view: "editor" };
const subs = new Set<() => void>();
export function setQbView(p: Partial<S>) { const n = { ...s, ...p }; if (n.external === s.external && n.view === s.view && n.canPriceList === s.canPriceList) return; s = n; subs.forEach((f) => f()); }
export function useQbView(): S { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => s, () => s); }

/** While the client view is open, let the phone pinch-zoom (the app viewport blocks it elsewhere). */
export function allowPinchZoom(on: boolean) {
  const m = document.querySelector('meta[name="viewport"]'); if (!m) return;
  const base = "width=device-width, initial-scale=1.0, viewport-fit=cover";
  m.setAttribute("content", on ? `${base}, maximum-scale=5, user-scalable=yes` : `${base}, maximum-scale=1.0, user-scalable=no`);
}

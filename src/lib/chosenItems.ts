/** Chosen items pane (Johan 30 Oct): the Visual PDF basket shown beside the quote. Pure helpers. */
import type { PdfSelectedProduct } from "@/types/pdfSelection";

export type ChosenLineRef = { lineId: string; areaName: string };
type QuoteLineLike = { id: string; product_id?: string | null; item_number?: string | null; item_name?: string | null; area_id?: string | null; parent_item_id?: string | null };
type AreaLike = { id: string; name: string };

const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();

/** Which quote lines (and rooms) each chosen item already sits in: by product id, else SKU, else exact name. */
export function matchChosenToLines(basket: PdfSelectedProduct[], lines: QuoteLineLike[], areas: AreaLike[]): Record<string, ChosenLineRef[]> {
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const out: Record<string, ChosenLineRef[]> = {};
  for (const b of basket) {
    const hits = lines.filter((l) => {
      if (l.parent_item_id) return false;
      if (b.productId && l.product_id) return l.product_id === b.productId;
      if (b.productCode && l.item_number) return norm(l.item_number) === norm(b.productCode);
      return !!norm(b.description) && norm(l.item_name) === norm(b.description);
    });
    out[b.code] = hits.map((l) => ({ lineId: l.id, areaName: (l.area_id && areaName.get(l.area_id)) || "No room" }));
  }
  return out;
}

/** Basket-only edits: never touch quote lines. */
export const setChosenQty = (basket: PdfSelectedProduct[], code: string, qty: number) =>
  basket.map((b) => (b.code === code ? { ...b, quantity: Math.max(1, Math.round(qty)) } : b));
export const removeChosen = (basket: PdfSelectedProduct[], code: string) => basket.filter((b) => b.code !== code);
export const chosenTotal = (basket: PdfSelectedProduct[]) => basket.reduce((s, b) => s + (parseFloat(b.price) || 0) * (Number(b.quantity) || 0), 0);

/** Jump to a quote line: open its room if collapsed, scroll it into view and flash it. */
export function jumpToQuoteLine(lineId: string) {
  if (typeof document === "undefined") return;
  const sel = `[data-line-id="${CSS.escape(lineId)}"]`;
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return;
  const go = () => {
    const row = document.querySelector<HTMLElement>(sel) || el;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("fl-chosen-flash");
    window.setTimeout(() => row.classList.remove("fl-chosen-flash"), 1600);
  };
  const room = el.closest<HTMLElement>('[data-area-collapsed="true"]');
  const toggle = room?.querySelector<HTMLElement>('.option1-collapse[aria-expanded="false"]');
  if (toggle) {
    toggle.click();
    window.setTimeout(go, 120);
    return;
  }
  go();
}

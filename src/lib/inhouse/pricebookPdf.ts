import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { INHOUSE_CATEGORY_LABELS } from "./sku";

/**
 * One Stop Shop in-house price book (2026-10-09): pure pdf-lib generator.
 * Prices printed = cost excl VAT (per item, or per coil for per-metre items) = cost_price =
 * list_price_raw, the same convention as the uploaded One Stop Shop list. Row/price boxes are
 * recorded while drawing, so the stored row_bbox/price_bbox are exact (top-left origin, 0..1).
 */
export interface BookItem {
  key: string;            // stable key (product id or temp id)
  sku_code: string;
  name: string;
  description?: string | null;
  category: string;
  cost: number;           // excl VAT; per coil for per-metre items
  per_metre: boolean;
  unit_length?: number | null; // coil / pack length in metres
}

export interface BBox { x: number; y: number; width: number; height: number }
export interface ItemLayout { page_number: number; row_bbox: BBox; price_bbox: BBox & { center_x: number } }
export interface BookResult {
  bytes: Uint8Array;
  pageCount: number;
  layout: Record<string, ItemLayout>;
  priceColumn: { x_frac: number; w_frac: number };
}

const W = 595.28, H = 841.89;          // A4 portrait (pt)
const M = 36;                           // margin
const ROW = 17, BAND = 20, HEAD_H = 92, FOOT = 34;
const COL = { code: M + 4, desc: M + 132, unit: 392, priceL: 470, priceR: W - M - 6 };
const BRAND = rgb(0.06, 0.31, 0.55), INK = rgb(0.1, 0.12, 0.16), GREY = rgb(0.45, 0.48, 0.52);
const BAND_BG = rgb(0.89, 0.93, 0.97), ZEBRA = rgb(0.965, 0.97, 0.975), LINE = rgb(0.82, 0.85, 0.88);

export const fmtRand = (n: number) =>
  "R " + (Math.round(n * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function unitLabel(i: BookItem): string {
  if (!i.per_metre) return "each";
  const len = Number(i.unit_length || 0);
  return `per m (${len % 1 === 0 ? len.toFixed(0) : len} m coil)`;
}

/** Category order: Johan's four first, then any other category A-Z; items by SKU. */
export function sortBookItems(items: BookItem[]): BookItem[] {
  const rank = (c: string) => { const i = INHOUSE_CATEGORY_LABELS.indexOf(c); return i < 0 ? 100 : i; };
  return [...items].sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category) || a.sku_code.localeCompare(b.sku_code));
}

function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  let t = text;
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxW) t = t.slice(0, -1);
  return t.replace(/\s+$/, "") + "…";
}
// Standard fonts are WinAnsi: replace characters they cannot encode.
const safe = (s: string) => String(s ?? "").replace(/²/g, "2").replace(/[^\x20-\x7E\u00A0-\u00FF…]/g, "");

export async function buildInhousePricebook(items: BookItem[], opts: { version: number; date: string; supplierName?: string }): Promise<BookResult> {
  const doc = await PDFDocument.create();
  doc.setTitle(`One Stop Shop in-house items v${opts.version}`);
  doc.setProducer("Field Lynk");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sorted = sortBookItems(items);
  const layout: Record<string, ItemLayout> = {};
  const pages: PDFPage[] = [];
  let page: PDFPage; let y = 0; // y = top of next row, measured from the TOP (pt)

  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: BRAND });
    page.drawText(safe((opts.supplierName || "ONE STOP SHOP").trim().toUpperCase()), { x: M, y: H - 34, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText(safe(`In-house items price list  ·  v${opts.version}  ·  ${opts.date}`), { x: M, y: H - 52, size: 9.5, font, color: rgb(0.88, 0.93, 1) });
    const r = "Prices excl. VAT";
    page.drawText(r, { x: W - M - font.widthOfTextAtSize(r, 9.5), y: H - 52, size: 9.5, font, color: rgb(0.88, 0.93, 1) });
    // column header
    const hy = H - 84;
    page.drawText("Code", { x: COL.code, y: hy, size: 8.5, font: bold, color: GREY });
    page.drawText("Description", { x: COL.desc, y: hy, size: 8.5, font: bold, color: GREY });
    page.drawText("Unit", { x: COL.unit, y: hy, size: 8.5, font: bold, color: GREY });
    const ph = "Price";
    page.drawText(ph, { x: COL.priceR - bold.widthOfTextAtSize(ph, 8.5), y: hy, size: 8.5, font: bold, color: GREY });
    page.drawLine({ start: { x: M, y: hy - 5 }, end: { x: W - M, y: hy - 5 }, thickness: 0.7, color: LINE });
    y = HEAD_H;
  };
  const room = (h: number) => y + h <= H - FOOT;

  newPage();
  if (sorted.length === 0) {
    page!.drawText("No in-house items yet.", { x: M, y: H - y - 24, size: 11, font, color: GREY });
  }
  let lastCat = ""; let zebra = false;
  for (const it of sorted) {
    if (it.category !== lastCat) {
      if (!room(BAND + ROW)) newPage();
      page!.drawRectangle({ x: M, y: H - y - BAND, width: W - 2 * M, height: BAND, color: BAND_BG });
      page!.drawText(safe(it.category.toUpperCase()), { x: COL.code, y: H - y - 14, size: 10, font: bold, color: BRAND });
      y += BAND; lastCat = it.category; zebra = false;
    } else if (!room(ROW)) {
      newPage();
      page!.drawText(safe(`${it.category.toUpperCase()} (continued)`), { x: COL.code, y: H - y - 14, size: 9, font: bold, color: GREY });
      y += BAND;
    }
    if (zebra) page!.drawRectangle({ x: M, y: H - y - ROW, width: W - 2 * M, height: ROW, color: ZEBRA });
    zebra = !zebra;
    const base = H - y - 12;
    page!.drawText(fit(bold, safe(it.sku_code), 8.5, COL.desc - COL.code - 6), { x: COL.code, y: base, size: 8.5, font: bold, color: INK });
    const desc = it.per_metre && it.unit_length ? `${it.name} - ${fmtRand(it.cost / Number(it.unit_length))}/m` : it.name;
    page!.drawText(fit(font, safe(desc), 9, COL.unit - COL.desc - 8), { x: COL.desc, y: base, size: 9, font, color: INK });
    page!.drawText(fit(font, safe(unitLabel(it)), 8.5, COL.priceL - COL.unit - 4), { x: COL.unit, y: base, size: 8.5, font, color: GREY });
    const price = fmtRand(it.cost);
    const pw = bold.widthOfTextAtSize(price, 9.5);
    page!.drawText(price, { x: COL.priceR - pw, y: base, size: 9.5, font: bold, color: INK });
    page!.drawLine({ start: { x: M, y: H - y - ROW }, end: { x: W - M, y: H - y - ROW }, thickness: 0.3, color: LINE });

    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const px = COL.priceL - 4, pwid = COL.priceR + 4 - px;
    layout[it.key] = {
      page_number: pages.length,
      row_bbox: { x: r4(M / W), y: r4(y / H), width: r4((W - 2 * M) / W), height: r4(ROW / H) },
      price_bbox: { x: r4(px / W), y: r4(y / H), width: r4(pwid / W), height: r4(ROW / H), center_x: r4((px + pwid / 2) / W) },
    };
    y += ROW;
  }
  pages.forEach((p, i) => {
    const f = `Page ${i + 1} of ${pages.length}  ·  Generated by Field Lynk from the in-house catalogue`;
    p.drawText(f, { x: M, y: 18, size: 7.5, font, color: GREY });
  });
  const bytes = await doc.save();
  return {
    bytes, pageCount: pages.length, layout,
    priceColumn: { x_frac: Math.round(((COL.priceL - 4) / W) * 10000) / 10000, w_frac: Math.round(((COL.priceR + 8 - COL.priceL) / W) * 10000) / 10000 },
  };
}

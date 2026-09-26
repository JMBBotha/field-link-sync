/**
 * Compact text of the whole open quote for Mandy's model context:
 * "Areas: General, Bedroom 1 | Bedroom 1: Samsung 12K INV MW [AR40F12C0AG/FA] Samsung 1×R9 738,26=R9 738,26; …
 *  | Subtotal R17 132,61 excl VAT, total R19 702,50".
 */
import { isKitItem, isLabourRow, type RArea, type RItem } from "@/lib/mandy/itemResolve";
import { spokenRand } from "@/lib/mandy/labourAction";

export function quoteLinesContext(q: { areas: RArea[]; items: RItem[]; subtotal?: number; total?: number }): string {
  const top = q.items.filter((i) => !i.parent_item_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const line = (i: RItem) => {
    const md = i.metadata || {};
    const tot = spokenRand(Number(i.total_price) || 0);
    if (isLabourRow(i)) return `Labour ${Number(md.hours ?? i.quantity ?? 0)}h×${spokenRand(Number(md.rate ?? i.unit_price ?? 0))}=${tot}`;
    const code = i.item_number ? ` [${i.item_number}]` : "";
    const brand = md.brand || i.supplier ? ` ${md.brand || i.supplier}` : "";
    if (isKitItem(i)) return `KIT ${i.item_name}${code} ${Number(i.length ?? md.length ?? 1)}m=${tot}`;
    return `${i.item_name}${code}${brand} ${Number(i.quantity) || 1}×${spokenRand(Number(i.unit_price) || 0)}=${tot}`;
  };
  const groups = [...q.areas, { id: null as any, name: "No area" }].map((a) => {
    const ls = top.filter((i) => (i.area_id ?? null) === a.id);
    return ls.length ? `${a.name}: ${ls.map(line).join("; ")}` : a.id ? `${a.name}: empty` : "";
  }).filter(Boolean);
  const tail = q.total != null ? ` | Subtotal ${spokenRand(q.subtotal || 0)} excl VAT, total ${spokenRand(q.total)}` : "";
  return `Areas: ${q.areas.map((a) => a.name).join(", ") || "none"} | ${groups.join(" | ")}${tail}`;
}

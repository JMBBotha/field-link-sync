// Quote email: compact "The units in this quote" strip (approved product_media only; fans/materials/labour never match).
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const normalizeModelCode = (c?: string | null) => {
  const s = String(c || "").split("+")[0].replace(/\(\s*x\s*\d+\s*\)/i, "").toUpperCase().replace(/\s+/g, "").replace(/-DUP\d*$/, "");
  return s || null;
};

const BROCHURE_ORIGIN = "https://field-link-sync.lovable.app";
export const brochureUrl = (modelKey: string, companyId?: string | null) =>
  `${BROCHURE_ORIGIN}/u/${encodeURIComponent(String(modelKey).trim().replace(/\s+/g, "").replace(/\//g, "-").toLowerCase())}${companyId ? `?c=${encodeURIComponent(companyId)}` : ""}`;

// One card per unit range: the same series in 12K and 24K shows once with "Sizes in this quote: 12 000 & 24 000 BTU".
const CAP_RE = /(?:^|[^0-9])(9|09|12|18|24|30|36|48|60)\s*(?:K|,?\s?000)\b/i;
export const unitCapacity = (m: { display_name?: string | null; model_code?: string | null }): number | null => {
  const t = `${m.display_name || ""} ${m.model_code || ""}`;
  const a = t.match(CAP_RE);
  if (a) return Number(a[1]);
  const b = String(m.model_code || "").match(/(?:^|[^0-9])(09|12|18|24|30|36|48|60)(?=[^0-9]|$)/);
  return b ? Number(b[1]) : null;
};
export const unitSeriesKey = (m: { display_name?: string | null; model_code?: string | null; model_key?: string | null }) => {
  const name = String(m.display_name || "").replace(/\b\d{1,2}\s*K\b|\b\d{1,2}[ ,]?000\b|\bBTU(\/H)?\b|\b\d+(\.\d+)?\s*kW\b/gi, "").replace(/[^a-z]+/gi, " ").trim().toLowerCase();
  if (name.length >= 4) return name;
  return String(m.model_code || m.model_key || "").toUpperCase().replace(/\d+/g, "#");
};
export function groupUnitSeries<T extends { display_name?: string | null; model_code?: string | null; model_key?: string | null }>(rows: T[]) {
  const map = new Map<string, { row: T; sizes: number[] }>();
  for (const r of rows) {
    const k = unitSeriesKey(r);
    const g = map.get(k) || { row: r, sizes: [] };
    const c = unitCapacity(r);
    if (c && !g.sizes.includes(c)) g.sizes.push(c);
    map.set(k, g);
  }
  return [...map.values()].map((g) => ({ ...g, sizes: g.sizes.sort((a, b) => a - b) }));
}
const sizeLabel = (sizes: number[]) => sizes.map((n) => `${n} 000`).join(" &amp; ") + " BTU";

export async function loadUnitCardsStripHtml(supabase: any, quoteId?: string | null): Promise<string> {
  if (!quoteId) return "";
  try {
    const { data: q } = await supabase.from("quotes").select("show_unit_cards, company_id").eq("id", quoteId).maybeSingle();
    if (q && q.show_unit_cards === false) return "";
    const { data: items } = await supabase.from("quote_items").select("item_type, item_number, supplier_products(product_code)").eq("quote_id", quoteId).is("parent_item_id", null);
    const keys = new Set<string>();
    for (const it of items || []) {
      if (/labour|service|material|consumable|kit/i.test(String(it.item_type || ""))) continue;
      const k = normalizeModelCode(it.supplier_products?.product_code || it.item_number);
      if (k) keys.add(k);
    }
    if (!keys.size) return "";
    const { data: media } = await supabase.from("product_media").select("model_key, model_code, display_name, subtitle, image_url, image_status").in("model_key", [...keys]).eq("status", "approved");
    const rows = (media || []).filter((m: any) => m.image_status === "ready" && m.image_url);
    if (!rows.length) return "";
    const groups = groupUnitSeries(rows).slice(0, 4);
    const cells = groups.map(({ row: m, sizes }: any) => {
      // No outside links in client emails (Johan 13 Oct 10:57); only our own brochure page (Johan 13 Oct 11:53, approved rows only).
      const img = `<img src="${esc(m.image_url)}" alt="${esc(m.model_code)}" width="120" style="display:block;margin:0 auto 6px;max-width:120px;height:auto;border:0;">`;
      return `<td align="center" valign="top" style="padding:8px;width:${Math.floor(100 / groups.length)}%;">
        <div style="background:#eaf6fd;border-radius:8px;padding:10px 6px;">${img}</div>
        <div style="font-size:12px;font-weight:700;color:#0B4FA8;margin-top:6px;">${esc(sizes.length > 1 ? String(m.display_name || m.model_code).replace(/\s*\b\d{1,2}\s*K\b(\s*BTU(\/H)?)?|\s*\b\d{1,2}[ ,]?000\s*BTU(\/H)?/gi, "").trim() : (m.display_name || m.model_code))}</div>
        ${sizes.length > 1
          ? `<div style="font-size:11px;color:#1d2a3a;margin-top:2px;">Sizes in this quote: <b>${sizeLabel(sizes)}</b></div>`
          : `<div style="font-size:11px;color:#6b7a8c;">${esc(m.subtitle || "")}</div><span style="font-size:11px;color:#6b7a8c;">${esc(m.model_code)}</span>`}
        <div style="margin-top:8px;"><a href="${esc(brochureUrl(m.model_key, q?.company_id))}" target="_blank" style="display:inline-block;background:#1AA7EC;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;border-radius:6px;padding:7px 12px;">View brochure</a></div>
      </td>`;
    }).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td style="border-left:4px solid #F7941D;padding-left:10px;font-size:15px;font-weight:800;color:#0B4FA8;">The units in this quote</td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>
      <tr><td style="font-size:10px;color:#4b5563;">Images are illustrative. Full details per unit in the attached quote and on the quote link.</td></tr>
    </table>`;
  } catch (e) {
    console.error("unit cards strip failed (email still sends):", e);
    return "";
  }
}

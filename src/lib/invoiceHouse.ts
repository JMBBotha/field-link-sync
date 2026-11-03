// House / unit number for an invoice (Johan 3 Nov 08:53: "make sure house numbers are clearly listed on invoices when searching").
// Source order: linked project house (invoices.project_house_id -> project_houses.house_no), then the
// "Warranty & notes" text (invoices.notes, e.g. "HOUSE 88 - AVEC"), then line-item headings.
const HOUSE_RE = /\b(?:house|hse|unit|h)\s*(?:no\.?|number|#)?\s*[-:#]?\s*(\d{1,4}[a-z]?)\b/i;

export function parseHouseNo(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text).match(HOUSE_RE);
  return m ? m[1].toUpperCase() : null;
}

type Inv = { notes?: string | null; line_items?: any; project_house_id?: string | null };

export function invoiceHouseNo(inv: Inv, houseNoById?: Map<string, string>): string | null {
  const linked = inv.project_house_id && houseNoById?.get(inv.project_house_id);
  if (linked) return String(linked).toUpperCase();
  const fromNotes = parseHouseNo(inv.notes);
  if (fromNotes) return fromNotes;
  const items = Array.isArray(inv.line_items) ? inv.line_items : [];
  for (const it of items) {
    const h = parseHouseNo(it?.description ?? it?.name);
    if (h) return h;
  }
  return null;
}

/** Does a search query match this house number? "House 32", "h32", "hse 32", "unit 32" or a bare "32". */
export function matchesHouseSearch(houseNo: string | null, query: string): boolean {
  if (!houseNo) return false;
  const q = query.trim();
  if (!q) return false;
  const want = parseHouseNo(q) ?? (/^\d{1,4}[a-z]?$/i.test(q) ? q.toUpperCase() : null);
  return want === houseNo;
}

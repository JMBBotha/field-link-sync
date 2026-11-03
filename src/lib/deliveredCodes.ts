/** Delivered indoor/outdoor codes (and serials) per job, suggested under the matching unit line on an invoice. */
export interface DeliveredUnit { job_id: string; product_id: string | null; half: "indoor" | "outdoor" | null; supplier_code: string; serial_no: string | null; qty: number }
export interface InvoiceLineLite { description: string; line_type?: string | null; quantity?: number }
export interface DeliveredSuggestion { lineIndex: number; text: string; alreadyOnLine: boolean }

const norm = (s: string) => s.toUpperCase().replace(/[\s_/.\-()]+/g, "");
/** Model base: drop Samsung N/X half letter, e.g. AR40H12C1AMN -> AR40H12C1AM. */
export const baseCode = (code: string) => { const c = norm(code); return /[0-9A-Z]{6,}[NX]$/.test(c) ? c.slice(0, -1) : c; };

interface Set_ { key: string; base: string; indoor: DeliveredUnit[]; outdoor: DeliveredUnit[]; single: DeliveredUnit[] }

export function groupUnits(units: DeliveredUnit[]): Set_[] {
  const m = new Map<string, Set_>();
  for (const u of units) {
    const base = baseCode(u.supplier_code); const key = u.product_id ?? base;
    const s = m.get(key) ?? { key, base, indoor: [], outdoor: [], single: [] }; m.set(key, s);
    (u.half === "indoor" ? s.indoor : u.half === "outdoor" ? s.outdoor : s.single).push(u);
  }
  return [...m.values()];
}

const codesWithSerials = (us: DeliveredUnit[]) => {
  const codes = [...new Set(us.map((u) => u.supplier_code.toUpperCase()))].join(", ");
  const sn = us.map((u) => u.serial_no).filter(Boolean) as string[];
  return sn.length ? `${codes} (S/N ${sn.join(", ")})` : codes;
};

export function suggestionText(s: Set_): string {
  if (s.indoor.length || s.outdoor.length) {
    const parts = [s.indoor.length ? `Indoor ${codesWithSerials(s.indoor)}` : null, s.outdoor.length ? `Outdoor ${codesWithSerials(s.outdoor)}` : null].filter(Boolean);
    return `Delivered: ${parts.join(" / ")}`;
  }
  return `Delivered: ${codesWithSerials(s.single)}`;
}

/** Match each delivered set to one invoice line: a line mentioning the model base code first, else the only unit line left. */
export function deliveredSuggestions(lines: InvoiceLineLite[], units: DeliveredUnit[]): DeliveredSuggestion[] {
  const out: DeliveredSuggestion[] = []; const used = new Set<number>();
  const sets = groupUnits(units);
  const left: Set_[] = [];
  for (const s of sets) {
    const i = lines.findIndex((l, k) => !used.has(k) && norm(l.description).includes(s.base));
    if (i >= 0) { used.add(i); out.push(mk(i, s)); } else left.push(s);
  }
  const unitLines = lines.map((l, k) => k).filter((k) => !used.has(k) && (lines[k].line_type === "unit" || lines[k].line_type === "item" || !lines[k].line_type) && !/install|labour|labor|deposit/i.test(lines[k].description));
  if (left.length === 1 && unitLines.length === 1) out.push(mk(unitLines[0], left[0]));
  return out.sort((a, b) => a.lineIndex - b.lineIndex);
  function mk(i: number, s: Set_): DeliveredSuggestion {
    const text = suggestionText(s);
    const codes = [...s.indoor, ...s.outdoor, ...s.single].map((u) => norm(u.supplier_code));
    return { lineIndex: i, text, alreadyOnLine: codes.every((c) => norm(lines[i].description).includes(c)) };
  }
}

/** Append the delivered text as a new line of the description (no duplicate). */
export const writeDelivered = (description: string, text: string) =>
  description.includes(text) ? description : `${description.replace(/\s+$/, "")}\n${text}`;

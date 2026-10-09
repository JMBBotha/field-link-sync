/** VAT report (accounting step 6): output VAT (invoices − credit notes) minus input VAT (expenses), by period. */
export interface VatLine { kind: "invoice" | "credit_note" | "expense"; date: string; ref: string | null; party: string | null; incl: number; rate: number; vat: number; stored_vat: number }
/** SARS category A: 2-month periods ending Jan/Mar/May/Jul/Sep/Nov. B: ending Feb/Apr/Jun/Aug/Oct/Dec. M: monthly. */
export type VatCycle = "A" | "B" | "M";
export interface VatPeriod { start: string; end: string; label: string; sales: number; outputVat: number; credits: number; creditVat: number; purchases: number; inputVat: number; net: number; docs: number; rateDiffs: number }

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodOf(date: string, cycle: VatCycle): { start: string; end: string; label: string } {
  let y = +date.slice(0, 4);
  const m = +date.slice(5, 7);
  let sm: number;
  if (cycle === "M") sm = m;
  else if (cycle === "B") sm = m % 2 === 1 ? m : m - 1;
  else { sm = m % 2 === 0 ? m : m - 1; if (sm === 0) { sm = 12; y -= 1; } }
  const len = cycle === "M" ? 1 : 2;
  let ey = y, em = sm + len - 1;
  if (em > 12) { em -= 12; ey += 1; }
  const label = len === 1 ? `${MON[sm - 1]} ${y}` : `${MON[sm - 1]}${ey !== y ? ` ${y}` : ""}–${MON[em - 1]} ${ey}`;
  return { start: `${y}-${pad(sm)}-01`, end: `${ey}-${pad(em)}-${pad(lastDay(ey, em))}`, label };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export function aggregateVat(lines: VatLine[], cycle: VatCycle): VatPeriod[] {
  const map = new Map<string, VatPeriod>();
  for (const l of lines) {
    const p = periodOf(l.date, cycle);
    const row = map.get(p.start) || { ...p, sales: 0, outputVat: 0, credits: 0, creditVat: 0, purchases: 0, inputVat: 0, net: 0, docs: 0, rateDiffs: 0 };
    const incl = Number(l.incl) || 0, vat = Number(l.vat) || 0;
    if (l.kind === "invoice") { row.sales += incl; row.outputVat += vat; }
    else if (l.kind === "credit_note") { row.credits += -incl; row.creditVat += -vat; }
    else { row.purchases += incl; row.inputVat += vat; }
    if (Math.abs(vat - (Number(l.stored_vat) || 0)) >= 0.01) row.rateDiffs++;
    row.docs++;
    map.set(p.start, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, sales: r2(r.sales), outputVat: r2(r.outputVat), credits: r2(r.credits), creditVat: r2(r.creditVat), purchases: r2(r.purchases), inputVat: r2(r.inputVat), net: r2(r.outputVat - r.creditVat - r.inputVat) }))
    .sort((a, b) => b.start.localeCompare(a.start));
}

export const KIND_LABEL: Record<VatLine["kind"], string> = { invoice: "Invoice", credit_note: "Credit note", expense: "Expense" };

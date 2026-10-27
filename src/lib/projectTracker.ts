// Project / development house tracker: one place for status colours, phase grouping and money.
export type HouseStatus = "done" | "in_progress" | "due" | "not_started";

export interface ProjectStep { id: string; step_key: string; label: string; rate: number; sort_order: number; done: boolean; paid: boolean; done_at?: string | null }
export interface ProjectPhase { id: string; name: string; house_from: number | null; house_to: number | null; sort_order: number }
export interface ProjectHouse {
  id: string; house_no: string; phase_id: string | null; po_number: string | null; make: string | null; unit_sizes: string | null;
  units_ordered: number; units_received: number; ready_for_aircon: boolean; ready_for_aircon_at: string | null;
  status_override: HouseStatus | null; notes: string | null; steps: ProjectStep[];
}
export interface HouseMoney { invoiced: number; paid: number; invoiceCount: number; invoiceNumbers: string[] }

export const UNITS_STEP = "units";

/** Status rule (Johan's colours):
 *  green  = every step done AND invoiced amount fully paid (> 0)
 *  red    = ticked "ready for aircon" and the units are not installed yet
 *  orange = any step started (done)
 *  grey   = nothing started
 *  A manual override always wins. */
export function houseStatus(h: Pick<ProjectHouse, "steps" | "ready_for_aircon" | "status_override">, money?: HouseMoney): HouseStatus {
  if (h.status_override) return h.status_override;
  const steps = h.steps || [];
  const allDone = steps.length > 0 && steps.every((s) => s.done);
  const fullyPaid = !!money && money.invoiced > 0 && money.paid + 0.005 >= money.invoiced;
  if (allDone && fullyPaid) return "done";
  const unitsDone = steps.some((s) => s.step_key === UNITS_STEP && s.done);
  if (h.ready_for_aircon && !unitsDone) return "due";
  if (steps.some((s) => s.done)) return "in_progress";
  return "not_started";
}

export const STATUS_META: Record<HouseStatus, { label: string; ring: string; dot: string }> = {
  done: { label: "Done & paid", ring: "border-emerald-500", dot: "bg-emerald-500" },
  in_progress: { label: "Being built", ring: "border-amber-500", dot: "bg-amber-500" },
  due: { label: "Due for aircon", ring: "border-red-500", dot: "bg-red-500" },
  not_started: { label: "Not started", ring: "border-slate-300 dark:border-slate-600", dot: "bg-slate-400" },
};

export const houseNum = (no: string) => { const m = /\d+/.exec(no || ""); return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER; };
export const sortHouses = <T extends { house_no: string }>(hs: T[]) =>
  [...hs].sort((a, b) => houseNum(a.house_no) - houseNum(b.house_no) || a.house_no.localeCompare(b.house_no));

/** Phase for a house: explicit phase_id, else first phase whose range contains the number. */
export function phaseFor(h: Pick<ProjectHouse, "phase_id" | "house_no">, phases: ProjectPhase[]): string | null {
  if (h.phase_id && phases.some((p) => p.id === h.phase_id)) return h.phase_id;
  const n = houseNum(h.house_no);
  const p = [...phases].sort((a, b) => a.sort_order - b.sort_order)
    .find((p) => (p.house_from == null || n >= p.house_from) && (p.house_to == null || n <= p.house_to));
  return p?.id ?? null;
}

export const phaseLabel = (p: ProjectPhase) =>
  `${p.name} (${p.house_from ?? "?"}${p.house_to == null ? "+" : `-${p.house_to}`})`;

export const DEFAULT_PHASES = [
  { name: "Phase 1", house_from: 1, house_to: 30, sort_order: 1 },
  { name: "Phase 2", house_from: 31, house_to: 60, sort_order: 2 },
  { name: "Phase 3", house_from: 61, house_to: 90, sort_order: 3 },
  { name: "Phase 4", house_from: 91, house_to: null, sort_order: 4 },
];
export const DEFAULT_STEPS = [
  { step_key: "piping", label: "Install piping", rate: 500, sort_order: 1 },
  { step_key: "units", label: "Install units", rate: 1200, sort_order: 2 },
  { step_key: "commissioning", label: "Commissioning", rate: 300, sort_order: 3 },
];
export const STEP_SHORT: Record<string, string> = { piping: "Pipe", units: "Units", commissioning: "Comm" };

interface InvRow { id: string; project_house_id: string | null; grand_total: number | null; status: string | null; invoice_number: string | null; archived_at?: string | null }
interface PayRow { invoice_id: string; amount: number | null; status: string | null }

const VOID = new Set(["void", "cancelled", "canceled", "credited"]);
const PAY_OK = (s: string | null) => !s || ["completed", "succeeded", "paid", "success", "complete"].includes(s.toLowerCase());

/** Invoiced vs paid per house, computed only from Field Lynk invoices + payments (never typed in). */
export function moneyByHouse(invoices: InvRow[], payments: PayRow[]): Record<string, HouseMoney> {
  const paidByInv: Record<string, number> = {};
  for (const p of payments) if (PAY_OK(p.status)) paidByInv[p.invoice_id] = (paidByInv[p.invoice_id] || 0) + Number(p.amount || 0);
  const out: Record<string, HouseMoney> = {};
  for (const i of invoices) {
    if (!i.project_house_id || i.archived_at || VOID.has((i.status || "").toLowerCase())) continue;
    const m = (out[i.project_house_id] ||= { invoiced: 0, paid: 0, invoiceCount: 0, invoiceNumbers: [] });
    m.invoiced += Number(i.grand_total || 0);
    m.paid += paidByInv[i.id] || 0;
    m.invoiceCount += 1;
    if (i.invoice_number) m.invoiceNumbers.push(i.invoice_number);
  }
  return out;
}

export const stepsTotal = (steps: ProjectStep[]) => steps.reduce((a, s) => a + Number(s.rate || 0), 0);

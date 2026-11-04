// Project / development house tracker: one place for status colours, phase grouping and money.
export type HouseStatus = "done" | "units_in" | "in_progress" | "due" | "not_started";

export interface ProjectStep { id: string; step_key: string; label: string; rate: number; sort_order: number; done: boolean; paid: boolean; done_at?: string | null }
export interface ProjectPhase { id: string; name: string; house_from: number | null; house_to: number | null; sort_order: number }
export interface ProjectHouse {
  id: string; house_no: string; phase_id: string | null; po_number: string | null; make: string | null; unit_sizes: string | null;
  units_ordered: number; units_received: number; ready_for_aircon: boolean; ready_for_aircon_at: string | null;
  status_override: HouseStatus | null; notes: string | null; steps: ProjectStep[];
}
export interface HouseInvoice { id: string; number: string | null; total: number; paid: number; sent_at: string | null; issue_date?: string | null }
export interface HouseMoney { invoiced: number; paid: number; invoiceCount: number; invoiceNumbers: string[]; invoices?: HouseInvoice[] }

export const UNITS_STEP = "units";
export const FIRST_FIT_STEP = "first_fit";
const DAY = 86_400_000;

/** The house's billing invoice: one invoice per house; first sent one wins, else the first one made. */
export function primaryInvoice(money?: HouseMoney): HouseInvoice | null {
  const inv = money?.invoices || [];
  return [...inv].filter((i) => i.sent_at).sort((a, b) => a.sent_at!.localeCompare(b.sent_at!))[0] || inv[0] || null;
}

/** Status rule (Johan 4 Nov 20:40). Stage keys are kept compatible with the existing status_override CHECK:
 *  not_started -> in_progress ("First fit done", get PO) -> due ("Invoiced", 50% due)
 *  -> units_in ("Units installed", final 50% due) -> done (full invoice paid). Manual override always wins. */
export function houseStatus(h: Pick<ProjectHouse, "steps" | "status_override">, money?: HouseMoney): HouseStatus {
  if (h.status_override) return h.status_override;
  const steps = h.steps || [];
  const fullyPaid = !!money && money.invoiced > 0 && money.paid + 0.005 >= money.invoiced;
  if (fullyPaid) return "done";
  if (steps.some((s) => s.step_key === UNITS_STEP && s.done)) return "units_in";
  const inv = primaryInvoice(money);
  if (inv?.sent_at) return "due";
  if (steps.some((s) => s.done)) return "in_progress";
  return "not_started";
}

export interface HouseReminder { kind: "send_estimate" | "check_units" | "final_due"; text: string }
/** In-app reminders, computed on the fly (nothing stored, nothing emailed). */
export function houseReminders(h: Pick<ProjectHouse, "steps" | "status_override">, money: HouseMoney | undefined, now = new Date()): HouseReminder[] {
  const st = houseStatus({ ...h, status_override: null }, money);
  const inv = primaryInvoice(money);
  if (st === "in_progress" && h.steps.some((s) => s.step_key === FIRST_FIT_STEP && s.done) && !inv?.sent_at)
    return [{ kind: "send_estimate", text: "Send estimate to get PO number" }];
  if (st === "due" && inv?.sent_at) {
    const days = Math.floor((now.getTime() - new Date(inv.sent_at).getTime()) / DAY);
    if (days >= 30) return [{ kind: "check_units", text: `Check if house is ready for units (${days >= 60 ? "60" : "30"}-day check)` }];
  }
  if (st === "units_in") return [{ kind: "final_due", text: `Final 50% due on ${inv?.number || "invoice"}` }];
  return [];
}

export const daysSince = (iso: string | null | undefined, now = new Date()) => iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY) : null;

export type StatusKey = HouseStatus;
export const STATUS_ORDER: HouseStatus[] = ["not_started", "in_progress", "due", "units_in", "done"];
export const STATUS_META: Record<HouseStatus, { label: string; ring: string; dot: string; chip: string }> = {
  not_started: { label: "Not started", ring: "border-slate-300 dark:border-slate-600", dot: "bg-slate-400", chip: "bg-slate-400 text-white" },
  in_progress: { label: "First fit done", ring: "border-amber-500", dot: "bg-amber-500", chip: "bg-amber-500 text-white" },
  due: { label: "Invoiced · 50% due", ring: "border-red-500", dot: "bg-red-500", chip: "bg-red-500 text-white" },
  units_in: { label: "Units in · final 50% due", ring: "border-violet-500", dot: "bg-violet-500", chip: "bg-violet-500 text-white" },
  done: { label: "Done & paid", ring: "border-emerald-500", dot: "bg-emerald-500", chip: "bg-emerald-500 text-white" },
};
/** Values the DB status_override CHECK accepts today (units_in is automatic only; no DB change needed). */
export const OVERRIDE_OK: HouseStatus[] = ["not_started", "in_progress", "due", "done"];

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
  { step_key: "first_fit", label: "First fit (sleeves & drains)", rate: 0, sort_order: 0 },
  { step_key: "piping", label: "Install piping", rate: 0, sort_order: 1 },
  { step_key: "units", label: "Install units", rate: 0, sort_order: 2 },
  { step_key: "commissioning", label: "Commissioning", rate: 0, sort_order: 3 },
];
export const STEP_SHORT: Record<string, string> = { first_fit: "1st fit", piping: "Pipe", units: "Units", commissioning: "Comm" };

interface InvRow { id: string; sent_at?: string | null; issue_date?: string | null; project_house_id: string | null; grand_total: number | null; status: string | null; invoice_number: string | null; archived_at?: string | null }
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
    (m.invoices ||= []).push({ id: i.id, number: i.invoice_number, total: Number(i.grand_total || 0), paid: paidByInv[i.id] || 0, sent_at: i.sent_at ?? null, issue_date: i.issue_date ?? null });
    m.invoiceCount += 1;
    if (i.invoice_number) m.invoiceNumbers.push(i.invoice_number);
  }
  return out;
}

export interface HousePhotos { count: number; jobs: { id: string; title: string; count: number }[] }
/** Job photos per house: house -> linked invoices -> jobs (by invoice_id or the invoice's lead) -> job_photos (by job lead). */
export function photosByHouse(
  invoices: { id: string; project_house_id: string | null; lead_id?: string | null }[],
  jobs: { id: string; title: string | null; invoice_id: string | null; lead_id: string | null }[],
  photos: { lead_id: string }[],
): Record<string, HousePhotos> {
  const perLead: Record<string, number> = {};
  for (const p of photos) perLead[p.lead_id] = (perLead[p.lead_id] || 0) + 1;
  const out: Record<string, HousePhotos> = {};
  for (const i of invoices) {
    if (!i.project_house_id) continue;
    for (const j of jobs) {
      if (j.invoice_id !== i.id && !(i.lead_id && j.lead_id === i.lead_id)) continue;
      const h = (out[i.project_house_id] ||= { count: 0, jobs: [] });
      if (h.jobs.some((x) => x.id === j.id)) continue;
      const c = j.lead_id ? perLead[j.lead_id] || 0 : 0;
      h.jobs.push({ id: j.id, title: j.title || "Job", count: c });
      h.count += c;
    }
  }
  return out;
}

export const stepsTotal = (steps: ProjectStep[]) => steps.reduce((a, s) => a + Number(s.rate || 0), 0);

export interface HouseDoc { id: string; doc_type: string; doc_number: string | null; supplier: string | null; doc_date: string | null; storage_path: string | null; jobIds: string[] }
export interface HouseDocs { count: number; docs: HouseDoc[] }
/** Private supplier docs per house (office only; RLS sjd_ok): house -> its jobs (from photosByHouse) -> confirmed supplier_job_document_links. */
export function docsByHouse(
  photos: Record<string, HousePhotos>,
  links: { job_id: string | null; status: string; doc: { id: string; doc_type: string; doc_number: string | null; supplier_name: string | null; doc_date: string | null; storage_path: string | null; supplier?: string | null } | null }[],
): Record<string, HouseDocs> {
  const out: Record<string, HouseDocs> = {};
  for (const [houseId, hp] of Object.entries(photos)) {
    const jobIds = new Set(hp.jobs.map((j) => j.id));
    const byDoc = new Map<string, HouseDoc>();
    for (const l of links) {
      if (l.status !== "confirmed" || !l.doc || !l.job_id || !jobIds.has(l.job_id)) continue;
      const d = byDoc.get(l.doc.id) || { id: l.doc.id, doc_type: l.doc.doc_type, doc_number: l.doc.doc_number, supplier: l.doc.supplier || l.doc.supplier_name, doc_date: l.doc.doc_date, storage_path: l.doc.storage_path, jobIds: [] };
      if (!d.jobIds.includes(l.job_id)) d.jobIds.push(l.job_id);
      byDoc.set(l.doc.id, d);
    }
    if (byDoc.size) out[houseId] = { count: byDoc.size, docs: [...byDoc.values()].sort((a, b) => (b.doc_date || "").localeCompare(a.doc_date || "")) };
  }
  return out;
}

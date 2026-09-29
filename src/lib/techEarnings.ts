/**
 * Tech "My earnings" tracker (Job 6) — pure helpers over get_tech_earnings().
 * The RPC already scopes rows: a tech gets only their own rows, the owner gets every tech, anyone else nothing.
 * Tech pay = paid on completion % + holdback % of labour sell ex VAT. Tools % is company money and never appears here.
 */
export type TechBucket = "paid_on_completion" | "holdback";
export type TechStatus = "accrued" | "payable" | "paid" | "held" | "released" | "reduced";
export type TechAction = "paid" | "unpay" | "release" | "reduce" | "undo";

export interface TechEarningRow {
  id: string | null;
  frozen: boolean;
  job_id: string | null;
  quote_id: string | null;
  quote_number: string | null;
  tech_id: string;
  tech_name: string | null;
  bucket: TechBucket;
  percent: number | null;
  amount: number | null;
  reduction_amount: number | null;
  net_amount: number | null;
  status: TechStatus;
  completed_at: string | null;
  release_after: string | null;
  releasable: boolean;
  callback_job_id: string | null;
  paid_at: string | null;
}
export interface TechEarnings { api_version: number; user_id: string; is_owner: boolean; today: string; rows: TechEarningRow[] }

export const STATUS_INFO: Record<TechStatus, { label: string; hint: string }> = {
  accrued: { label: "Accrued", hint: "Job not completed yet" },
  payable: { label: "Payable", hint: "Job completed, to be paid" },
  paid: { label: "Paid", hint: "Paid to you" },
  held: { label: "Held", hint: "Holdback until the release date" },
  released: { label: "Released", hint: "Holdback paid to you" },
  reduced: { label: "Reduced", hint: "Holdback reduced by a callback" },
};

export const SECTIONS: { bucket: TechBucket; label: string; statuses: TechStatus[] }[] = [
  { bucket: "paid_on_completion", label: "Paid on completion", statuses: ["accrued", "payable", "paid"] },
  { bucket: "holdback", label: "Holdback", statuses: ["accrued", "held", "released", "reduced"] },
];

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Net amount of a row (amount minus any callback reduction). */
export const netOf = (r: TechEarningRow) => r2(r.net_amount != null ? num(r.net_amount) : num(r.amount) - num(r.reduction_amount));

/** Per-section totals by status (optionally for one tech). */
export function summarize(rows: TechEarningRow[], techId?: string | null) {
  const scoped = techId ? rows.filter((r) => r.tech_id === techId) : rows;
  return SECTIONS.map((s) => {
    const list = scoped.filter((r) => r.bucket === s.bucket);
    const byStatus = s.statuses.map((st) => {
      const l = list.filter((r) => r.status === st);
      return { status: st, ...STATUS_INFO[st], count: l.length, amount: r2(l.reduce((a, r) => a + netOf(r), 0)) };
    }).filter((x) => x.status !== "accrued" || x.count > 0 || s.bucket === "paid_on_completion");
    return { ...s, rows: list, total: r2(list.reduce((a, r) => a + netOf(r), 0)), byStatus };
  });
}

/** Distinct techs in the rows (owner filter), by name. */
export function techsOf(rows: TechEarningRow[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) if (r.tech_id && !m.has(r.tech_id)) m.set(r.tech_id, (r.tech_name || "Unknown").trim());
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Owner actions allowed for a stored row (the server enforces the same rules). */
export function actionsFor(r: TechEarningRow, isOwner: boolean): TechAction[] {
  if (!isOwner || !r.id || !r.frozen) return [];
  if (r.bucket === "paid_on_completion") return r.status === "payable" ? ["paid"] : r.status === "paid" ? ["unpay"] : [];
  if (r.status === "held") return r.releasable ? ["release", "reduce"] : ["reduce"];
  return r.status === "released" || r.status === "reduced" ? ["undo"] : [];
}

export const ACTION_LABEL: Record<TechAction, string> = {
  paid: "Mark paid", unpay: "Undo paid", release: "Release", reduce: "Reduce (callback)", undo: "Undo",
};

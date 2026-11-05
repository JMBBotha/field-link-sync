import { bucketFor, samsungHalf, type PreviewRow } from "./stockReceive";

/** One quote line on a job (quote_items via jobs.quote_id). A split AC quote line covers indoor + outdoor. */
export interface JobQuoteLine { job_id: string; product_id: string | null; quantity: number }
export interface JobRef { id: string; label: string; has_quote?: boolean }

export type Half = "indoor" | "outdoor" | null;
export interface ReconLine { index: number; item: string; model: string | null; qty: number; target: string; target_kind: "job" | "general" | "pool" | "installed" | "skip" | "none";
  job_id: string | null; half: Half; line_cost: number | null; issue: string | null }
export interface JobTotal { job_id: string | null; label: string; lines: number; cost: number; issues: string[] }
export interface Recon { lines: ReconLine[]; jobs: JobTotal[]; total: number; problems: string[]; ok: boolean }

/** Split units sold as one catalogue pair (indoor + outdoor). Portable / window units are single pieces. */
export const isPairProduct = (r: PreviewRow) => {
  const p = r.match.product;
  if (!p || p.product_type !== "ac_unit") return false;
  return !/portable|window|mobile/i.test(`${p.name ?? ""} ${p.short_name ?? ""} ${p.description ?? ""}`);
};
/** Outdoor half carries an X after the size digits (FCMI-24X-P); the indoor half does not. */
export const halfOf = (r: PreviewRow): Half => (isPairProduct(r) ? (samsungHalf(r.stock_key) ?? (/\dX$/.test(r.stock_key) ? "outdoor" : "indoor")) : null);

const nice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Reconciliation before Confirm. Blocks when:
 *  - a line is not in the catalogue (e.g. FCMI-L Lite look-alike), or is reserved/installed without a job;
 *  - a job gets an indoor half without the matching outdoor half (or the counts differ);
 *  - a job's reserved quantity for a product differs from its quote line, or the product is not on its quote.
 */
export function buildRecon(rows: PreviewRow[], jobs: JobRef[], quoteLines: JobQuoteLine[]): Recon {
  const label = (id: string | null) => jobs.find((j) => j.id === id)?.label ?? (id ? id.slice(0, 8) : "—");
  const lines: ReconLine[] = rows.map((r, index) => {
    const p = r.match.product;
    const bucket = bucketFor(r.action, p, r.map);
    const needsJob = bucket === "job_unit";
    let issue: string | null = null;
    if (!p) issue = r.match.lookalikes.length ? `Not matched (look-alike ${r.match.lookalikes.map((x) => x.product_code).join(", ")} is a different model)` : "Not matched to the catalogue";
    else if (bucket === "material_pool" && (r.action === "reserve" || r.action === "installed")) issue = "Materials stay in the pool — they are not reserved to a job";
    else if (needsJob && !r.job_id) issue = "No job chosen";
    const target_kind: ReconLine["target_kind"] = !p ? "none"
      : bucket === "material_pool" && (r.action === "reserve" || r.action === "installed") ? "none"
      : bucket === "job_unit" ? (r.job_id ? (r.action === "installed" ? "installed" : "job") : "none")
      : bucket === "general_unit" ? "general"
      : bucket === "material_pool" ? "pool"
      : r.action === "skip" ? "skip" : "none";
    const target = target_kind === "job" ? label(r.job_id) : target_kind === "installed" ? `${label(r.job_id)} (on site)` : target_kind === "general" ? "General stock" : target_kind === "pool" ? "Materials pool" : target_kind === "skip" ? "Skipped" : "Unassigned";
    return { index, item: p?.short_name || p?.name || r.line.description, model: r.line.model_number, qty: r.line.qty, target, target_kind,
      job_id: needsJob ? r.job_id : null, half: halfOf(r), line_cost: r.unit_cost_pack == null ? null : r.unit_cost_pack * r.line.qty, issue };
  });

  const groups = new Map<string, JobTotal>();
  const key = (l: ReconLine) => (l.job_id ? `job:${l.job_id}` : l.target_kind);
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k) ?? { job_id: l.job_id, label: l.job_id ? label(l.job_id) : l.target, lines: 0, cost: 0, issues: [] };
    g.lines++; g.cost += l.line_cost ?? 0; groups.set(k, g);
  }

  for (const g of groups.values()) {
    if (!g.job_id) continue;
    const mine = lines.filter((l) => l.job_id === g.job_id);
    const byProduct = new Map<string, { name: string; pair: boolean; indoor: number; outdoor: number; qty: number }>();
    for (const l of mine) {
      const r = rows[l.index]; const pid = r.match.product!.id;
      const b = byProduct.get(pid) ?? { name: l.item, pair: l.half != null, indoor: 0, outdoor: 0, qty: 0 };
      if (l.half === "indoor") b.indoor += l.qty; else if (l.half === "outdoor") b.outdoor += l.qty; else b.qty += l.qty;
      byProduct.set(pid, b);
    }
    const quote = quoteLines.filter((q) => q.job_id === g.job_id);
    const hasQuote = jobs.find((j) => j.id === g.job_id)?.has_quote ?? quote.length > 0;
    for (const [pid, b] of byProduct) {
      if (b.pair && b.indoor !== b.outdoor)
        g.issues.push(b.outdoor === 0 ? `${b.name}: indoor without its outdoor half` : b.indoor === 0 ? `${b.name}: outdoor without its indoor half` : `${b.name}: ${nice(b.indoor)} indoor vs ${nice(b.outdoor)} outdoor`);
      if (!hasQuote) continue;
      const want = quote.filter((q) => q.product_id === pid).reduce((a, q) => a + Number(q.quantity || 0), 0);
      const got = b.pair ? Math.max(b.indoor, b.outdoor) : b.qty;
      if (want === 0) g.issues.push(`${b.name}: not on this job's quote`);
      else if (Math.abs(got - want) > 1e-6) g.issues.push(`${b.name}: note has ${nice(got)}, quote has ${nice(want)}`);
    }
  }

  const jobsOut = [...groups.values()].sort((a, b) => (a.job_id ? 0 : 1) - (b.job_id ? 0 : 1) || a.label.localeCompare(b.label));
  const problems = [
    ...lines.filter((l) => l.issue).map((l) => `Line ${l.index + 1} (${l.model ?? l.item}): ${l.issue}`),
    ...jobsOut.flatMap((g) => g.issues.map((i) => `${g.label}: ${i}`)),
  ];
  return { lines, jobs: jobsOut, total: lines.reduce((a, l) => a + (l.line_cost ?? 0), 0), problems, ok: problems.length === 0 };
}

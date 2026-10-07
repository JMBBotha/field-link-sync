import { isAcUnitLine, type AcUnitLineInput, type AcUnitProductInput } from "@/lib/lineDisplay";
import { isLabourItem, labourFields } from "@/lib/labour";

export interface AreaLabourLine extends AcUnitLineInput {
  id?: string;
  quantity?: number | null;
  area_id?: string | null;
  parent_item_id?: string | null;
  product?: AcUnitProductInput | null;
}

export function countAcUnits(lines: AreaLabourLine[]): number {
  return lines.reduce((sum, line) => {
    if (line.parent_item_id || !isAcUnitLine(line, line.product)) return sum;
    const qty = Number(line.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}

export function defaultLabourHours(units: number, perUnit: number): number {
  return Math.round(Math.max(0, Number(units) || 0) * Math.max(0, Number(perUnit) || 0) * 100) / 100;
}

export function areaLabourStatus(lines: AreaLabourLine[], perUnit = 3.5) {
  const labourLines = lines.filter((line) => !line.parent_item_id && isLabourItem(line));
  const hours = labourLines.reduce((sum, line) => sum + Math.max(0, Number((line.metadata as any)?.hours ?? line.quantity) || 0), 0);
  const areaHasLines = lines.some((line) => !line.parent_item_id && !isLabourItem(line));
  return {
    labourLines,
    hours,
    missing: areaHasLines && hours <= 0,
    defaultHours: defaultLabourHours(countAcUnits(lines), perUnit),
    isAuto: labourLines.length > 0 && labourLines.every((line) => (line.metadata as any)?.labour_auto === true),
  };
}

export function missingLabourAreas<T extends { id: string; name: string }>(areas: T[], lines: AreaLabourLine[], perUnit = 3.5): T[] {
  return areas.filter((area) => areaLabourStatus(lines.filter((line) => line.area_id === area.id), perUnit).missing);
}

export type LabourMode = "per_area" | "job";
export const DEFAULT_LABOUR_MODE: LabourMode = "per_area";
export const JOB_LABOUR_KEY = "job";

export function normalizeLabourMode(v: unknown): LabourMode {
  return v === "job" ? "job" : "per_area";
}

/** The single whole-job labour row: top-level labour with metadata.labour_scope = 'job'. Its area_id is ignored:
 *  an old orphan move gave Q-2026-0014's job row an area and it vanished from the screen while still in the totals. */
export function isJobLabour(line: { area_id?: string | null; parent_item_id?: string | null; item_type?: string | null; metadata?: any } | null | undefined): boolean {
  return !!line && !line.parent_item_id && isLabourItem(line as any) && (line.metadata as any)?.labour_scope === "job";
}

/** Where auto labour lands: the area for 'per_area', the job row (null area) for 'job'. */
export function labourTargetAreaId(mode: LabourMode, areaId: string | null): string | null {
  return mode === "job" ? null : areaId;
}

/**
 * Labour-required check used by Save/Send/PDF/Print/Accept.
 * per_area: every populated area needs labour. job: one job labour row with hours > 0 when the quote has lines.
 */
export function missingLabourFor<T extends { id: string; name: string }>(
  mode: LabourMode, areas: T[], lines: AreaLabourLine[], perUnit = 3.5,
): { id: string; name: string }[] {
  if (mode !== "job") return missingLabourAreas(areas, lines, perUnit);
  const hasLines = lines.some((l) => !l.parent_item_id && !isLabourItem(l as any));
  if (!hasLines) return [];
  const hours = lines.filter((l) => isJobLabour(l as any))
    .reduce((s, l) => s + Math.max(0, Number((l.metadata as any)?.hours ?? l.quantity) || 0), 0);
  return hours > 0 ? [] : [{ id: JOB_LABOUR_KEY, name: "Job labour" }];
}

/** per_area -> job: total hours moved onto one row. */
export function planToJob(areaHours: number[]): number {
  return Math.round(areaHours.reduce((s, h) => s + Math.max(0, Number(h) || 0), 0) * 100) / 100;
}

/** job -> per_area: defaults per area, difference absorbed so the total is unchanged (mirrors set_quote_labour_mode). */
export function planToPerArea(jobHours: number, areas: { id: string; units: number }[], perUnit: number): { id: string; hours: number }[] {
  const plan = areas.map((a) => ({ id: a.id, hours: defaultLabourHours(a.units, perUnit) }));
  if (!plan.length) return plan;
  let diff = Math.round((jobHours - plan.reduce((s, p) => s + p.hours, 0)) * 100) / 100;
  if (diff >= 0) {
    (plan.find((p) => p.hours > 0) ?? plan[0]).hours += diff;
  } else {
    for (const p of plan) {
      if (diff >= 0) break;
      const take = Math.min(p.hours, -diff);
      p.hours = Math.round((p.hours - take) * 100) / 100;
      diff = Math.round((diff + take) * 100) / 100;
    }
  }
  return plan.map((p) => ({ ...p, hours: Math.round(p.hours * 100) / 100 }));
}

type LabourWriter = {
  items: any[];
  areaId: string | null;
  unitDelta: number;
  perUnit: number;
  rate: number;
  addItem: (item: any) => Promise<any>;
  updateItem: (id: string, patch: any) => Promise<any>;
  /** Target the whole-job labour row instead of an area row. */
  job?: boolean;
};

/** Apply an AC quantity delta only to an auto labour row; create one when none exists. */
export async function applyAutoLabourDelta({ items, areaId, unitDelta, perUnit, rate, addItem, updateItem, job }: LabourWriter) {
  if ((!job && !areaId) || !unitDelta || !(rate > 0)) return null;
  const labour = job
    ? items.find((line) => isJobLabour(line))
    : items.find((line) => line.area_id === areaId && !line.parent_item_id && isLabourItem(line));
  if (labour && (labour.metadata as any)?.labour_auto !== true) return labour;
  const current = labour ? Number((labour.metadata as any)?.hours ?? labour.quantity) || 0 : 0;
  const hours = Math.max(0, Math.round((current + unitDelta * Math.max(0, perUnit)) * 100) / 100);
  const base = labourFields(hours, rate, false, true);
  const fields = job ? { ...base, item_name: "Job labour", metadata: { ...base.metadata, labour_scope: "job" } } : base;
  if (labour) {
    await updateItem(labour.id, job ? { ...fields, area_id: null } : fields);
    return labour;
  }
  // A removal cannot invent a legacy labour row; only positive unit adds create one.
  if (unitDelta < 0) return null;
  const sort = items.length ? Math.max(...items.map((line) => Number(line.sort_order) || 0)) + 1 : 0;
  return addItem({ ...fields, area_id: job ? null : areaId, sort_order: sort, source: "labour" });
}

/** Idempotent projection from actual units, not click deltas. Manual rows are never changed. */
export function reconcileAutoLabour<T extends AreaLabourLine>(items: T[], areas: { id: string; name: string }[], mode: LabourMode, perUnit: number, rate: number): T[] {
  const result = items.filter((i) => !(isLabourItem(i) && i.metadata?.labour_auto === true));
  const targets = mode === "job" ? [null] : areas.map((a) => a.id);
  for (const areaId of targets) {
    const scope = items.filter((i) => !i.parent_item_id && (mode === "job" ? isLabourItem(i) ? isJobLabour(i) : true : i.area_id === areaId && !isJobLabour(i)));
    const manual = scope.some((i) => isLabourItem(i) && i.metadata?.labour_auto !== true);
    if (manual) continue;
    const hours = defaultLabourHours(countAcUnits(scope), perUnit);
    const existing = scope.find((i) => isLabourItem(i) && i.metadata?.labour_auto === true);
    const savedRate = Number(existing?.metadata?.rate ?? (existing as any)?.unit_price) || rate;
    if (!(hours > 0 && savedRate > 0)) continue;
    const fields = labourFields(hours, savedRate, !!existing?.metadata?.rate_overridden, true);
    result.push({ ...existing, ...fields, id: existing?.id ?? `auto-labour-${areaId ?? "job"}`, area_id: areaId, parent_item_id: null,
      metadata: { ...existing?.metadata, ...fields.metadata, ...(mode === "job" ? { labour_scope: "job" } : {}) },
      ...(mode === "job" ? { item_name: "Job labour" } : {}),
    } as unknown as T);
  }
  return result;
}

type LabourLineLike = { area_id?: string | null; parent_item_id?: string | null; item_type?: string | null; metadata?: any };
const inKnownArea = (i: LabourLineLike, areas: { id: string }[]) => !!i.area_id && areas.some((a) => a.id === i.area_id);

/** Null/unknown-area labour shown in the amber box. The job row is listed only in per_area mode (nowhere else shows it there). */
export function unassignedLabourLines<T extends LabourLineLike>(lines: T[], areas: { id: string }[], mode: LabourMode = "job"): T[] {
  return lines.filter((i) => !i.parent_item_id && isLabourItem(i as any) && !inKnownArea(i, areas) && !(mode === "job" && isJobLabour(i)));
}

/** Job mode: the Job labour section shows the job row plus any area labour, so every counted labour line is on screen. */
export function jobModeLabourLines<T extends LabourLineLike>(lines: T[], areas: { id: string }[]): T[] {
  return lines.filter((i) => !i.parent_item_id && isLabourItem(i as any) && (isJobLabour(i) || inKnownArea(i, areas)));
}

/**
 * Job mode allows ONE job labour line. A labour insert while in job mode (Mandy area labour, the builder row, a restore)
 * merges its hours into the existing job line (keeping that line's rate) or becomes the job line. Other rows pass through.
 */
export function planLabourInsert<T extends LabourLineLike & { id?: string; quantity?: any; unit_price?: any; item_name?: string | null }>(
  mode: LabourMode, items: T[], row: any,
): { kind: "insert"; row: any } | { kind: "merge"; id: string; patch: any } {
  if (row?.parent_item_id || !isLabourItem(row)) return { kind: "insert", row };
  if (mode !== "job") {
    const existing = row.metadata?.labour_auto === true ? items.find((i) => i.id && i.area_id === row.area_id && !i.parent_item_id && isLabourItem(i)) : undefined;
    if (!existing?.id) return { kind: "insert", row };
    return { kind: "merge", id: existing.id, patch: existing.metadata?.labour_auto === true ? row : {} };
  }
  const existing = items.find((i) => isJobLabour(i) && i.id !== row.id);
  const asJob = (fields: any) => ({ ...fields, area_id: null, item_name: "Job labour", metadata: { ...(fields.metadata || {}), labour_scope: "job" } });
  if (!existing?.id) return { kind: "insert", row: asJob(row) };
  const md = (existing.metadata || {}) as any;
  const hours = (Number(md.hours ?? existing.quantity) || 0) + (Number(row.metadata?.hours ?? row.quantity) || 0);
  const rate = Number(md.rate ?? existing.unit_price) || Number(row.metadata?.rate ?? row.unit_price) || 0;
  const f = labourFields(hours, rate, !!md.rate_overridden, md.labour_auto === true && row.metadata?.labour_auto === true);
  return { kind: "merge", id: existing.id, patch: { ...asJob(f), item_name: existing.item_name || "Job labour" } };
}

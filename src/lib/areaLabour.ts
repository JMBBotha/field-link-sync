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
/** Where auto labour lands. Only 'per_area' is built; 'job' is planned. */
export function labourTargetAreaId(mode: LabourMode, areaId: string): string {
  return mode === "per_area" ? areaId : areaId;
}

type LabourWriter = {
  items: any[];
  areaId: string;
  unitDelta: number;
  perUnit: number;
  rate: number;
  addItem: (item: any) => Promise<any>;
  updateItem: (id: string, patch: any) => Promise<any>;
};

/** Apply an AC quantity delta only to an auto labour row; create one when none exists. */
export async function applyAutoLabourDelta({ items, areaId, unitDelta, perUnit, rate, addItem, updateItem }: LabourWriter) {
  if (!areaId || !unitDelta || !(rate > 0)) return null;
  const labour = items.find((line) => line.area_id === areaId && !line.parent_item_id && isLabourItem(line));
  if (labour && (labour.metadata as any)?.labour_auto !== true) return labour;
  const current = labour ? Number((labour.metadata as any)?.hours ?? labour.quantity) || 0 : 0;
  const hours = Math.max(0, Math.round((current + defaultLabourHours(unitDelta, perUnit)) * 100) / 100);
  const fields = labourFields(hours, rate, false, true);
  if (labour) {
    await updateItem(labour.id, fields);
    return labour;
  }
  // A removal cannot invent a legacy labour row; only positive unit adds create one.
  if (unitDelta < 0) return null;
  const sort = items.length ? Math.max(...items.map((line) => Number(line.sort_order) || 0)) + 1 : 0;
  return addItem({ ...fields, area_id: areaId, sort_order: sort, source: "labour" });
}
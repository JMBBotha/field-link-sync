/**
 * Pricing-check chips — pure. Non-blocking hints above the Profit card.
 * Never reprices: fixes are explicit, user-confirmed edits with an undo payload.
 */
import { computeMargin, sellForTarget, type MarginLineInput, type MarginSettings } from "@/lib/margin";
import { pickInstallTemplate, type InstallRole, type InstallTemplate } from "@/lib/installTemplates";

export interface CheckLine {
  id: string;
  name: string;
  areaId: string | null;
  qty: number;
  unitPrice: number;
  unitCost: number | null;
  isLabour: boolean;
  /** Picked from catalog_services. */
  isService: boolean;
  /** AC unit line (the thing that needs an install). */
  isUnit: boolean;
  btu: number | null;
  /** Free text used to spot unit kind: name + category + unit_type. */
  kindText: string;
  installRole: InstallRole | null;
  isKit: boolean;
  /** Kit metres (piping), when known. */
  kitMetres: number | null;
  /** Per-metre / price-locked lines are never scaled. */
  locked: boolean;
  labourHours?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ───────────── 1. GP vs target ───────────── */

export const isNotPriced = (l: CheckLine) => (l.isService && !(l.unitPrice > 0)) || (!l.isLabour && l.unitCost == null);

export interface GpCheck {
  gpPercent: number | null;
  target: number;
  belowTarget: boolean;
  notPriced: number;
  /** Extra sell (ex VAT) needed on priced lines to hit target, 0 when fine. */
  uplift: number;
}

export function gpCheck(lines: CheckLine[], discount: number, s: MarginSettings): GpCheck {
  const priced = lines.filter((l) => !isNotPriced(l));
  const inputs: MarginLineInput[] = priced.map((l) => ({ id: l.id, name: l.name, areaId: l.areaId, qty: l.qty, unitPrice: l.unitPrice, unitCost: l.unitCost, isLabour: l.isLabour, isService: l.isService }));
  // Discount share that lands on priced lines.
  const gross = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const pricedGross = priced.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const d = gross > 0 ? (Math.max(0, discount) * pricedGross) / gross : 0;
  const m = computeMargin(inputs, d, s);
  const uplift = m.belowTarget ? Math.max(0, r2(sellForTarget(m.job.cost, s.gpTargetPercent) - m.job.sell)) : 0;
  return { gpPercent: m.job.gpPercent, target: s.gpTargetPercent, belowTarget: m.belowTarget, notPriced: lines.length - priced.length, uplift };
}

export interface PriceUndo { id: string; unit_price: number; total_price: number }
export type PriceToTargetPlan =
  | { kind: "clear_discount"; undo: { discount_type: string | null; discount_value: number } }
  | { kind: "scale"; patches: PriceUndo[]; undo: PriceUndo[]; factor: number }
  | { kind: "none" };

/**
 * Least invasive fix: drop an existing job discount; otherwise scale the priced
 * AC unit lines (fallback: priced non-labour, non-locked lines) by one factor.
 */
export function planPriceToTarget(lines: CheckLine[], discount: { type: string | null; value: number }, check: GpCheck): PriceToTargetPlan {
  if (!check.belowTarget) return { kind: "none" };
  if (discount.type && discount.value > 0) return { kind: "clear_discount", undo: { discount_type: discount.type, discount_value: discount.value } };
  const pool = (f: (l: CheckLine) => boolean) => lines.filter((l) => !isNotPriced(l) && !l.isLabour && !l.locked && l.unitPrice > 0 && f(l));
  let targets = pool((l) => l.isUnit);
  if (!targets.length) targets = pool(() => true);
  const base = targets.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  if (!(base > 0) || !(check.uplift > 0)) return { kind: "none" };
  const factor = (base + check.uplift) / base;
  const patches = targets.map((l) => {
    const up = Math.ceil(l.unitPrice * factor * 100) / 100;
    return { id: l.id, unit_price: up, total_price: r2(up * l.qty) };
  });
  const undo = targets.map((l) => ({ id: l.id, unit_price: l.unitPrice, total_price: r2(l.unitPrice * l.qty) }));
  return { kind: "scale", patches, undo, factor };
}

/* ───────────── 2. Missing materials ───────────── */

export type MaterialGroup = "kit" | "bracket" | "electrical" | "consumables";
export const GROUP_LABEL: Record<MaterialGroup, string> = { kit: "piping kit", bracket: "bracket", electrical: "electrical", consumables: "consumables" };
export const ROLE_GROUP: Partial<Record<InstallRole, MaterialGroup>> = {
  piping_kit: "kit", bracket: "bracket", cable_interconnect: "electrical", cable_supply: "electrical",
  trunking_main: "consumables", trunking_endcap: "consumables", trunking_small: "consumables", drain_pipe: "consumables", drain_bend: "consumables",
};

function groupOfLine(l: CheckLine): MaterialGroup | null {
  if (l.installRole && ROLE_GROUP[l.installRole]) return ROLE_GROUP[l.installRole]!;
  if (l.isKit) return "kit";
  const n = l.name.toLowerCase();
  if (/bracket|mounting|wall mount/.test(n)) return "bracket";
  if (/isolator|cable|wire/.test(n)) return "electrical";
  if (/trunking|drain|insulation tape|duct tape|end cap|elbow/.test(n)) return "consumables";
  return null;
}

export interface MissingMaterials { areaId: string | null; unitId: string; missing: MaterialGroup[]; roles: InstallRole[] }

/** Areas with an AC unit whose standard-install template expects a group the area has none of. */
export function missingMaterials(lines: CheckLine[], templates: InstallTemplate[]): MissingMaterials[] {
  const out: MissingMaterials[] = [];
  const areaIds = [...new Set(lines.filter((l) => l.isUnit).map((l) => l.areaId))];
  for (const a of areaIds) {
    const inArea = lines.filter((l) => l.areaId === a);
    const unit = inArea.find((l) => l.isUnit)!;
    const tpl = pickInstallTemplate(templates, unit.btu);
    const expectedRoles: InstallRole[] = tpl ? tpl.items.filter((i) => i.included).map((i) => i.role) : ["piping_kit"];
    const have = new Set(inArea.map(groupOfLine).filter(Boolean) as MaterialGroup[]);
    const missing: MaterialGroup[] = [];
    const roles: InstallRole[] = [];
    for (const g of ["kit", "bracket", "electrical", "consumables"] as MaterialGroup[]) {
      const rs = expectedRoles.filter((r) => ROLE_GROUP[r] === g);
      if (rs.length && !have.has(g)) { missing.push(g); roles.push(...rs); }
    }
    if (missing.length) out.push({ areaId: a, unitId: unit.id, missing, roles });
  }
  return out;
}

/* ───────────── 3. Labour norms ───────────── */

export interface LabourNorm { key: string; label: string; hours: number }

export function unitNormKey(kindText: string, btu: number | null): string {
  const t = kindText.toLowerCase();
  if (/cassette/.test(t)) return "cassette_install";
  if (/under ?ceiling|console/.test(t)) return "underceiling_install";
  if (/ducted|hideaway|bulkhead/.test(t)) return "ducted_install";
  if (/package/.test(t)) return "package_install";
  const k = btu ? btu / 1000 : 0;
  if (k > 24) return "split_30k_plus";
  if (k > 12) return "split_18_24k";
  return "split_upto_12k";
}

/** catalog_services name → norm key (null = no norm, e.g. the unit itself carries the install hours). */
export function serviceNormKey(name: string): string | null {
  const n = name.toLowerCase();
  if (/removal and reinstall/.test(n)) return "removal_reinstall";
  if (/^removal/.test(n)) return "removal";
  if (/pc board/.test(n)) return "pcb";
  if (/isolator|electrical/.test(n)) return "electrical";
  if (/repair|diagnos/.test(n)) return "repair";
  if (/service of split/.test(n)) return "service_split";
  if (/cassette|hideaway/.test(n)) return "service_cassette_hideaway";
  if (/ducted/.test(n)) return "service_ducted";
  if (/package/.test(n)) return "package_install";
  return null;
}

export interface LabourGap { areaId: string | null; hours: number; norm: number; parts: string[] }

export function labourGaps(lines: CheckLine[], norms: LabourNorm[], standardKitM = 3): LabourGap[] {
  const byKey = new Map(norms.map((n) => [n.key, n]));
  const out: LabourGap[] = [];
  for (const a of [...new Set(lines.map((l) => l.areaId))]) {
    const inArea = lines.filter((l) => l.areaId === a);
    let norm = 0;
    const parts: string[] = [];
    for (const l of inArea) {
      const key = l.isUnit ? unitNormKey(l.kindText, l.btu) : l.isService ? serviceNormKey(l.name) : null;
      const n = key ? byKey.get(key) : undefined;
      if (n) { norm += n.hours * Math.max(1, l.qty || 1); parts.push(n.label); }
      if (l.isKit && l.kitMetres && l.kitMetres > standardKitM) {
        const per = byKey.get("piping_extra_per_m");
        if (per) { norm += per.hours * (l.kitMetres - standardKitM); parts.push(per.label); }
      }
    }
    if (norm <= 0) continue;
    norm = Math.ceil(norm * 2) / 2; // labour steps in 0.5 h
    const hours = inArea.filter((l) => l.isLabour).reduce((s, l) => s + (l.labourHours ?? l.qty), 0);
    if (hours < norm) out.push({ areaId: a, hours, norm, parts });
  }
  return out;
}

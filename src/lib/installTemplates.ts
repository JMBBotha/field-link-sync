/**
 * Standard install templates — ONE shared resolver for every place that adds
 * an AC unit (estimate picker, Mandy, multi-step plans, clickable builder).
 */
import { supabase } from "@/integrations/supabase/client";

export type InstallRole =
  | "piping_kit" | "bracket" | "trunking_main" | "trunking_endcap" | "trunking_small"
  | "drain_pipe" | "drain_bend" | "cable_interconnect" | "cable_supply" | "other";

export interface InstallTemplateItem {
  id: string;
  role: InstallRole;
  bundle_id: string | null;
  product_code: string | null;
  default_qty: number;
  default_length_m: number | null;
  included: boolean;
  sort_order: number;
}

export interface InstallTemplate {
  id: string;
  name: string;
  min_btu: number;
  max_btu: number;
  unit_kind?: string | null;
  is_active: boolean;
  sort_order: number;
  items: InstallTemplateItem[];
}

export interface InstallTag { unit_item_id: string; role: InstallRole; template_id: string | null }

export const DEFAULT_INSTALL_KIT_M = 3;

/** Template whose BTU range contains the unit's BTU (active only, lowest sort first). */
export function pickInstallTemplate(templates: InstallTemplate[] | undefined, btu: number | null): InstallTemplate | null {
  if (!templates?.length || !btu || btu <= 0) return null;
  return [...templates]
    .filter((t) => t.is_active !== false && btu >= t.min_btu && btu <= t.max_btu)
    .sort((a, b) => a.sort_order - b.sort_order)[0] || null;
}

export const ROLE_LABEL: Record<InstallRole, string> = {
  piping_kit: "kit", bracket: "bracket", trunking_main: "trunking", trunking_endcap: "end cap",
  trunking_small: "small trunking", drain_pipe: "drain", drain_bend: "elbow", cable_interconnect: "interconnect cable",
  cable_supply: "supply cable", other: "item",
};

/** "1 × 3 m length" for items sold per supplier length; null otherwise. */
export function lengthLabel(qty: number, supplierLengthM: number | null | undefined): string | null {
  if (!supplierLengthM || supplierLengthM <= 0) return null;
  const q = Number(qty) || 1;
  return `${q} × ${Number(supplierLengthM)} m length${q === 1 ? "" : "s"}`;
}

/** Read the install tag off a saved quote line. */
export function installTag(item: { metadata?: any } | null | undefined): InstallTag | null {
  const t = item?.metadata?.install;
  return t && t.unit_item_id && t.role ? (t as InstallTag) : null;
}

/** Bracket swap options (live-catalog codes). */
export const BRACKET_OPTIONS = [
  { code: "BRAC01", label: "450 bracket" },
  { code: "BRAC02", label: "550 bracket" },
  { code: "BRAC05", label: "650 bracket" },
  { code: "BRAC14", label: "Flatback 450" },
  { code: "BRAC15", label: "Flatback 550" },
];

export async function fetchInstallTemplates(): Promise<InstallTemplate[]> {
  const { data, error } = await (supabase.from("install_templates" as any) as any)
    .select("id, name, min_btu, max_btu, unit_kind, is_active, sort_order, install_template_items(id, role, bundle_id, product_code, default_qty, default_length_m, included, sort_order)")
    .order("sort_order");
  if (error) throw error;
  return ((data || []) as any[]).map((t) => ({
    ...t,
    items: ((t.install_template_items || []) as any[])
      .map((i) => ({ ...i, default_qty: Number(i.default_qty) || 1, default_length_m: i.default_length_m == null ? null : Number(i.default_length_m) }))
      .sort((a, b) => a.sort_order - b.sort_order),
  }));
}

/** Client-side install link carried on a builder basket line (unitKey = the unit line's instanceId). */
export interface BasketInstall { unitKey: string; role: InstallRole; template_id: string | null; supplier_length_m?: number | null }

/** Basket install link → saved metadata (unit_item_id still holds the unit's instanceId until remapped). */
export function basketInstallMeta(inst: BasketInstall | undefined | null): Record<string, any> {
  if (!inst) return {};
  return {
    install: { unit_item_id: inst.unitKey, role: inst.role, template_id: inst.template_id ?? null },
    ...(inst.supplier_length_m ? { supplier_length_m: inst.supplier_length_m, qty_unit: "length" } : {}),
  };
}

/** Saved row → basket install link (hydration). */
export function basketInstallFrom(item: { metadata?: any }): BasketInstall | undefined {
  const t = installTag(item);
  if (!t) return undefined;
  return { unitKey: t.unit_item_id, role: t.role, template_id: t.template_id ?? null, supplier_length_m: item.metadata?.supplier_length_m ?? null };
}

/**
 * Replace-all save: rows get NEW ids. Point every install tag at its unit's
 * new id (oldKey → newId). A tag whose unit is not in this save is dropped.
 */
export function remapInstallUnitIds<T extends { metadata?: any }>(rows: T[], idMap: Map<string, string>): T[] {
  return rows.map((r) => {
    const t = installTag(r);
    if (!t) return r;
    const nid = idMap.get(t.unit_item_id);
    const md = { ...(r.metadata || {}) };
    if (nid) md.install = { ...md.install, unit_item_id: nid };
    else delete md.install;
    return { ...r, metadata: md };
  });
}

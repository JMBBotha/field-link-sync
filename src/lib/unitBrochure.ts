import { dimensionSpecRows } from "@/lib/unitCards";

/** Our own unit brochure pages (Johan 13 Oct 11:42): QR codes and model links on quote unit cards point here, never to outside sites. */
export const BROCHURE_ORIGIN = "https://field-link-sync.lovable.app";

/** URL-safe model slug: "AR09BSHGAWK/FA" -> "ar09bshgawk-fa" (the lookup accepts both forms). */
export function modelSlug(modelKey: string): string {
  return String(modelKey || "").trim().replace(/\s+/g, "").replace(/\//g, "-").toLowerCase();
}

export function unitBrochureUrl(modelKey: string, companyId?: string | null): string {
  const base = `${BROCHURE_ORIGIN}/u/${encodeURIComponent(modelSlug(modelKey))}`;
  return companyId ? `${base}?c=${encodeURIComponent(companyId)}` : base;
}

export interface BrochureCompany {
  company_id: string; name?: string | null; legal_name?: string | null; logo_url?: string | null;
  phone?: string | null; email?: string | null; website?: string | null; whatsapp?: string | null;
  document_style?: "light" | "bold" | string | null;
}

/** Spec table rows from verified product_media.specs only (nothing invented; missing keys are skipped). */
export function brochureSpecRows(specs: Record<string, any> | null | undefined, modelCode: string): [string, string][] {
  const s = specs || {};
  const has = (v: any) => v !== null && v !== undefined && v !== "";
  const rows: [string, string][] = [["Model", modelCode]];
  if (has(s.btu)) rows.push(["Capacity", `${String(Math.round(Number(s.btu))).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} BTU/h`]);
  if (has(s.cool_kw)) rows.push(["Cooling capacity", `${s.cool_kw} kW`]);
  if (has(s.heat_kw)) rows.push(["Heating capacity", `${s.heat_kw} kW`]);
  if (has(s.eer) && has(s.cop)) rows.push(["Efficiency", `EER ${s.eer} · COP ${s.cop}`]);
  else if (has(s.eer)) rows.push(["Efficiency", `EER ${s.eer}`]);
  if (has(s.seer)) rows.push(["SEER", String(s.seer)]);
  if (has(s.energy_class)) rows.push(["Energy class", String(s.energy_class)]);
  if (has(s.noise_in_db)) rows.push(["Indoor noise (high/low)", `${String(s.noise_in_db).replace("/", " / ")} dBA`]);
  if (has(s.noise_out_db)) rows.push(["Outdoor noise", `${s.noise_out_db} dBA`]);
  if (has(s.inverter)) rows.push(["Compressor", s.inverter ? "Inverter" : "Fixed speed"]);
  if (has(s.refrigerant)) rows.push(["Refrigerant", String(s.refrigerant)]);
  if (has(s.pipe)) rows.push(["Pipe sizes", String(s.pipe)]);
  if (s.wifi === true) rows.push(["Wi-Fi", "Built in"]);
  if (has(s.room_m2)) rows.push(["Room size", `≈ ${s.room_m2} m²`]);
  if (has(s.warranty)) rows.push(["Warranty", String(s.warranty)]);
  rows.push(...dimensionSpecRows(s));
  return rows;
}

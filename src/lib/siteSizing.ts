/**
 * On-site unit sizing check (Johan 2026-10-18), same rules Sam uses:
 * /workspace/sales-agent-2026-10-18/sizing-and-install.md section A.
 */
export const SIZE_LADDER = [9000, 12000, 18000, 24000, 36000] as const;

export interface SizingInput {
  floorM2: number;
  ceilingM?: number | null;
  /** Connected open-plan area that can't be closed off by a door. */
  openPlanM2?: number | null;
  sun?: boolean; topFloor?: boolean; kitchen?: boolean; busy?: boolean;
}
export interface SizingResult { btu: number | null; effectiveM2: number; siteVisit: boolean; reason?: string }

const bandFor = (m2: number): number | null =>
  m2 <= 15 ? 9000 : m2 <= 24 ? 12000 : m2 <= 35 ? 18000 : m2 <= 48 ? 24000 : m2 <= 70 ? 36000 : null;

export function recommendBtu(i: SizingInput): SizingResult {
  const floor = Math.max(0, Number(i.floorM2) || 0) + Math.max(0, Number(i.openPlanM2) || 0);
  const h = Number(i.ceilingM) || 0;
  if (!floor) return { btu: null, effectiveM2: 0, siteVisit: false, reason: "Enter the room size" };
  if (h > 3.5) return { btu: null, effectiveM2: floor, siteVisit: true, reason: "Ceiling above 3.5 m: needs a proper heat-load check" };
  const eff = h >= 2.8 ? floor * (h / 2.6) : floor;
  let btu = bandFor(eff);
  if (btu == null) return { btu: null, effectiveM2: eff, siteVisit: true, reason: "Room over 70 m²: needs a proper heat-load check" };
  const factors = [i.sun, i.topFloor, i.kitchen, i.busy].filter(Boolean).length;
  if (factors > 0) {
    const idx = SIZE_LADDER.indexOf(btu as (typeof SIZE_LADDER)[number]);
    btu = SIZE_LADDER[Math.min(idx + 1, SIZE_LADDER.length - 1)];
  }
  const siteVisit = btu > 24000 || (factors >= 2 && btu >= 24000) || floor > 48;
  return { btu, effectiveM2: Math.round(eff * 10) / 10, siteVisit };
}

/** "Size OK" when the quoted unit is the recommended size or one step bigger (never smaller). */
export function sizeVerdict(quotedBtu: number | null | undefined, rec: SizingResult): "ok" | "too_small" | "too_big" | "unknown" {
  if (!quotedBtu || !rec.btu) return "unknown";
  if (quotedBtu < rec.btu) return "too_small";
  const qi = SIZE_LADDER.findIndex((b) => b >= quotedBtu);
  const ri = SIZE_LADDER.indexOf(rec.btu as (typeof SIZE_LADDER)[number]);
  return qi - ri > 1 ? "too_big" : "ok";
}

export const btuLabel = (b?: number | null) => (b ? `${Math.round(b / 1000)}K BTU` : "—");

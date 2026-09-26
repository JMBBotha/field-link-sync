/**
 * Piping kit copper sizes ("3/8 + 1/2") read from a kit's own copper
 * components — never invented. Used for kit swap labels, spoken kit swaps
 * and preferring a kit that matches a unit's pipe_liquid / pipe_gas.
 */
export interface KitLike { id: string; name: string; description?: string | null; min_btu?: number | null; max_btu?: number | null; items: any[]; is_active?: boolean }

const FRACTIONS = ["1/4", "3/8", "1/2", "5/8", "3/4", "7/8"];
const val = (f: string) => { const [a, b] = f.split("/").map(Number); return a / b; };

/** First inch fraction in a string: '1/4"', '1/4 Inch', '6.35mm' (→1/4) … */
export function pipeFraction(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).match(/\b([1357])\s*\/\s*([248])\b/);
  if (m) { const f = `${m[1]}/${m[2]}`; return FRACTIONS.includes(f) ? f : null; }
  const mm = Number(String(s).replace(",", ".").match(/(\d+(?:\.\d+)?)\s*mm/i)?.[1]);
  if (mm) { const hit = FRACTIONS.find((f) => Math.abs(val(f) * 25.4 - mm) < 0.4); return hit || null; }
  return null;
}

/** Copper sizes of a kit, small → large, e.g. ["3/8","1/2"]. */
export function kitPipeSizes(kit: KitLike): string[] {
  const sizes = new Set<string>();
  for (const it of kit.items || []) {
    const p = it.product || {};
    const name = `${p.short_name || ""} ${p.description || ""}`;
    if (!/copper/i.test(name)) continue;
    const f = pipeFraction(p.short_name || name);
    if (f) sizes.add(f);
  }
  if (!sizes.size) {
    const m = String(kit.name).match(/([1357]\/[248])\s*&?\s*(?:and|\+|&)?\s*([1357]\/[248])/);
    if (m) { sizes.add(m[1]); sizes.add(m[2]); }
  }
  return [...sizes].sort((a, b) => val(a) - val(b));
}

export const kitSizeLabel = (kit: KitLike) => kitPipeSizes(kit).join(" + ");

const isPiping = (k: KitLike) => /PIPING/i.test(`${k.name} ${k.description || ""}`);

/** Active piping kits whose every component is live in the active books. */
export function swappableKits(bundles: KitLike[], liveProducts: { id: string }[]): KitLike[] {
  const live = new Set(liveProducts.map((p) => p.id));
  return bundles.filter((b) => b.is_active !== false && isPiping(b) && b.items?.length > 0
    && b.items.every((i: any) => live.has(i.product?.id || i.supplier_product_id)) && kitPipeSizes(b).length >= 2);
}

/** Kit with exactly these copper sizes (order-free). */
export function kitForSizes(bundles: KitLike[], sizes: string[]): KitLike | null {
  const want = [...new Set(sizes)].sort((a, b) => val(a) - val(b)).join("+");
  return bundles.filter(isPiping).find((b) => kitPipeSizes(b).join("+") === want) || null;
}

/** Prefer a kit matching the unit's pipe_liquid + pipe_gas; null when not filled or no match. */
export function kitForUnitPipes(bundles: KitLike[], unit: { pipe_liquid?: string | null; pipe_gas?: string | null }): KitLike | null {
  const a = pipeFraction(unit?.pipe_liquid), b = pipeFraction(unit?.pipe_gas);
  if (!a || !b) return null;
  return kitForSizes(bundles, [a, b]);
}

const SPOKEN: [RegExp, string][] = [
  [/\bthree[\s-]eighths?\b/g, "3/8"], [/\bfive[\s-]eighths?\b/g, "5/8"], [/\bseven[\s-]eighths?\b/g, "7/8"],
  [/\bthree[\s-]quarters?\b/g, "3/4"], [/\b(?:a\s+)?quarter\b/g, "1/4"], [/\b(?:a\s+)?half\b/g, "1/2"],
];

/** "use the three eighths half kit" → ["3/8","1/2"]; null unless it names a kit/piping and two sizes. */
export function parseKitSwapSizes(text: string): string[] | null {
  let t = ` ${String(text || "").toLowerCase()} `;
  if (!/\b(kit|piping|copper)\b/.test(t)) return null;
  for (const [re, f] of SPOKEN) t = t.replace(re, ` ${f} `);
  const found = [...t.matchAll(/\b([1357])\s*\/\s*([248])\b/g)].map((m) => `${m[1]}/${m[2]}`).filter((f) => FRACTIONS.includes(f));
  const uniq = [...new Set(found)];
  return uniq.length === 2 ? uniq.sort((a, b) => val(a) - val(b)) : null;
}

/* ─── Unit pipe sizes → kit ─────────────────────────────────────────────── */

const MM_RE = /(\d+(?:[.,]\d+)?)\s*(?=[\/x&×]|\s|mm|$)/gi;

/**
 * Two inch fractions in a pipe-size text → { liquid: smaller, gas: larger }.
 * '1/4" x 3/8"', '3/8 5/8', '1/4 & 1/2', '6.35/12.7mm'. Mixed numbers
 * ('1 1/8', '1&1/8') and whole inches are ignored → null unless exactly 2 sizes.
 */
export function pipePairFromText(s: string | null | undefined): { liquid: string; gas: string } | null {
  if (!s) return null;
  const t = String(s);
  let found = [...t.matchAll(/(?<![0-9&])([1357])\s*\/\s*([248])(?![0-9])/g)].map((m) => `${m[1]}/${m[2]}`).filter((f) => FRACTIONS.includes(f));
  if (!found.length && /mm/i.test(t)) {
    found = [...t.matchAll(MM_RE)].map((m) => Number(m[1].replace(",", ".")))
      .map((mm) => FRACTIONS.find((f) => Math.abs(val(f) * 25.4 - mm) < 0.4)).filter(Boolean) as string[];
  }
  const uniq = [...new Set(found)].sort((a, b) => val(a) - val(b));
  return uniq.length === 2 ? { liquid: uniq[0], gas: uniq[1] } : null;
}

/**
 * Import rule: pipe fields to write for a parsed row. Manual rows are never
 * touched; never nulls out existing values.
 */
export function importPipeFields(
  existing: { pipe_sizes_manual?: boolean | null; pipe_liquid?: string | null; pipe_gas?: string | null } | null | undefined,
  pipeSizeText: string | null | undefined,
): { pipe_size?: string; pipe_liquid?: string; pipe_gas?: string } {
  if (existing?.pipe_sizes_manual) return {};
  const out: { pipe_size?: string; pipe_liquid?: string; pipe_gas?: string } = {};
  if (pipeSizeText && String(pipeSizeText).trim()) out.pipe_size = String(pipeSizeText).trim();
  const pair = pipePairFromText(pipeSizeText);
  if (pair) { out.pipe_liquid = pair.liquid; out.pipe_gas = pair.gas; }
  return out;
}

export type KitPickReason = "pipe" | "brand_btu" | "closest" | "btu";
export interface UnitLike { brand?: string | null; pipe_liquid?: string | null; pipe_gas?: string | null; [k: string]: any }

const eighths = (f: string) => Math.round(val(f) * 8);

function unitPair(u: UnitLike | null | undefined): [string, string] | null {
  const a = pipeFraction(u?.pipe_liquid), b = pipeFraction(u?.pipe_gas);
  return a && b ? [a, b] : null;
}

/** Closest piping kit to a pair: min |Δliquid|+|Δgas| (1/8ths); tie → same liquid, then larger gas. */
export function closestKit(bundles: KitLike[], pair: [string, string]): KitLike | null {
  const [l, g] = pair.map(eighths);
  let best: { k: KitLike; d: number; sameL: number; gas: number } | null = null;
  for (const k of bundles.filter(isPiping)) {
    const s = kitPipeSizes(k);
    if (s.length !== 2) continue;
    const kl = eighths(s[0]), kg = eighths(s[1]);
    const c = { k, d: Math.abs(kl - l) + Math.abs(kg - g), sameL: kl === l ? 1 : 0, gas: kg };
    if (!best || c.d < best.d || (c.d === best.d && (c.sameL > best.sameL || (c.sameL === best.sameL && c.gas > best.gas)))) best = c;
  }
  return best?.k ?? null;
}

/**
 * THE auto-pick for a unit's piping kit:
 * 1) exact pipe_liquid+pipe_gas; 2) no sizes → most common pair among live units
 * of the same brand+BTU; 3) closest kit (with a note); 4) BTU rule fallback.
 */
export function pickKitForUnit<K extends KitLike>(
  bundles: K[],
  unit: UnitLike,
  opts: { allUnits?: UnitLike[]; btuOf?: (u: UnitLike) => number | null; btuFallback?: () => K | null } = {},
): { kit: K | null; reason: KitPickReason; note?: string } {
  let pair = unitPair(unit);
  let reason: KitPickReason = "pipe";
  if (!pair && opts.allUnits?.length && opts.btuOf) {
    const brand = String(unit.brand || "").trim().toLowerCase();
    const btu = opts.btuOf(unit);
    if (brand && btu) {
      const counts = new Map<string, number>();
      for (const u of opts.allUnits) {
        if (String(u.brand || "").trim().toLowerCase() !== brand || opts.btuOf(u) !== btu) continue;
        const p = unitPair(u);
        if (p) counts.set(p.join("+"), (counts.get(p.join("+")) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) { pair = top[0].split("+") as [string, string]; reason = "brand_btu"; }
    }
  }
  if (pair) {
    const exact = kitForSizes(bundles, pair) as K | null;
    if (exact) return { kit: exact, reason };
    const near = closestKit(bundles, pair) as K | null;
    if (near) return { kit: near, reason: "closest", note: `Closest kit (unit is ${pair.join("+")}) – tap to swap` };
  }
  return { kit: opts.btuFallback ? opts.btuFallback() : null, reason: "btu" };
}

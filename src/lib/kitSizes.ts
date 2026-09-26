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

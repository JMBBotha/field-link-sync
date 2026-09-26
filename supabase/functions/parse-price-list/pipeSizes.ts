// Mirror of src/lib/kitSizes.ts pipePairFromText (edge functions can't import src/).
const FRACTIONS = ["1/4", "3/8", "1/2", "5/8", "3/4", "7/8"];
const val = (f: string) => { const [a, b] = f.split("/").map(Number); return a / b; };

export function pipePairFromText(s: string | null | undefined): { liquid: string; gas: string } | null {
  if (!s) return null;
  const t = String(s);
  let found = [...t.matchAll(/(?<![0-9&])([1357])\s*\/\s*([248])(?![0-9])/g)].map((m) => `${m[1]}/${m[2]}`).filter((f) => FRACTIONS.includes(f));
  if (!found.length && /mm/i.test(t)) {
    found = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?=[\/x&×]|\s|mm|$)/gi)].map((m) => Number(m[1].replace(",", ".")))
      .map((mm) => FRACTIONS.find((f) => Math.abs(val(f) * 25.4 - mm) < 0.4)).filter(Boolean) as string[];
  }
  const uniq = [...new Set(found)].sort((a, b) => val(a) - val(b));
  return uniq.length === 2 ? { liquid: uniq[0], gas: uniq[1] } : null;
}

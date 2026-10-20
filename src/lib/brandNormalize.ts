/** Shared brand normaliser for supplier_products / pdf_uploads writes. */
const CANONICAL: Record<string, string> = {
  daikin: "Daikin",
  samsung: "Samsung",
  midea: "Midea",
  comfee: "Comfee",
  comfy: "Comfee",
  alliance: "Alliance",
  pedrollo: "Pedrollo",
  lg: "LG",
  "one stop shop": "One Stop Shop",
};

export function normalizeBrand(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = String(s).trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return CANONICAL[trimmed.toLowerCase()] ?? trimmed;
}

/** Known brands, used to pre-fill the brand from a price-list file name. */
export const KNOWN_BRANDS = ["Samsung", "Alliance", "Comfee", "Midea", "Daikin", "LG", "Pedrollo", "One Stop Shop"];

/** Guess a brand from a file name (e.g. "FWGroup SAMSUNG Price List.pdf" -> "Samsung"). */
export function guessBrandFromFileName(fileName: string, extra: string[] = []): string | null {
  const lower = ` ${fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  if (/\bcomfy\b/.test(lower)) return "Comfee";
  const all = Array.from(new Set([...KNOWN_BRANDS, ...extra.filter(Boolean)]));
  for (const b of all) {
    const key = ` ${b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (lower.includes(key)) return normalizeBrand(b);
  }
  return null;
}

/** Shared brand normaliser for supplier_products / pdf_uploads writes. */
const CANONICAL: Record<string, string> = {
  daikin: "Daikin",
  samsung: "Samsung",
  midea: "Midea",
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

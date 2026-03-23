export interface ProductBrochure {
  id: string;
  name: string;
  brand: string;
  file_url: string;
  model_match_prefixes: string[];
  sort_order: number;
}

export function matchBrochuresToQuote(
  lineItemModelCodes: string[],
  allBrochures: ProductBrochure[]
): ProductBrochure[] {
  const matched = new Map<string, ProductBrochure>();

  for (const brochure of allBrochures) {
    if (matched.has(brochure.id)) continue;

    for (const code of lineItemModelCodes) {
      const upperCode = (code || "").toUpperCase().trim();
      if (!upperCode) continue;

      const isMatch = brochure.model_match_prefixes.some((prefix) =>
        upperCode.startsWith(prefix.toUpperCase().trim())
      );

      if (isMatch) {
        matched.set(brochure.id, brochure);
        break;
      }
    }
  }

  return Array.from(matched.values()).sort((a, b) => a.sort_order - b.sort_order);
}

import { isAcUnitLine, type AcUnitLineInput, type AcUnitProductInput } from "./acUnitLine.ts";

/**
 * Edge copy of src/lib/quoteUnitImages.ts. send-quote-email bundles this file.
 * The unit-line rule comes from ./acUnitLine.ts, the edge copy of isAcUnitLine.
 *
 * Which quote lines must have a photo before Send or Email.
 * Uses the same unit-line rule as the quote (isAcUnitLine): labour, kits,
 * consumables, and accessories such as remotes are not blocked.
 */

export interface QuoteImageLine extends AcUnitLineInput {
  id?: string | null;
  product_id?: string | null;
  item_number?: string | null;
}

export interface QuoteImageProduct extends AcUnitProductInput {
  id?: string | null;
  image_url?: string | null;
}

export interface MissingUnitImage {
  id: string;
  name: string;
  productId: string | null;
}

export function linesMissingUnitImages(
  lines: QuoteImageLine[] | null | undefined,
  products: QuoteImageProduct[] | null | undefined,
): MissingUnitImage[] {
  const byId = new Map<string, QuoteImageProduct>();
  for (const product of products || []) {
    if (product?.id) byId.set(product.id, product);
  }
  const missing: MissingUnitImage[] = [];
  for (const line of lines || []) {
    const product = line.product_id ? byId.get(line.product_id) ?? null : null;
    if (!isAcUnitLine(line, product)) continue;
    const image = String(product?.image_url || "").trim();
    if (image) continue;
    const name = String(line.item_name || line.item_number || "Unit").trim() || "Unit";
    missing.push({ id: String(line.id || name), name, productId: line.product_id || null });
  }
  return missing;
}

/** Names the lines. `hint` adds the sentence used when this screen has no Find images button. */
export function missingUnitImageMessage(names: string[], opts: { hint?: boolean } = {}): string {
  const clean = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  const shown = clean.slice(0, 8);
  const extra = clean.length - shown.length;
  const list = shown.join(", ") + (extra > 0 ? ` and ${extra} more` : "");
  const who = list || "a unit";
  const hint = opts.hint === false ? "" : " Open the quote and tap Find images.";
  return `A quote can't go out until every unit has a photo. Still missing: ${who}.${hint}`;
}

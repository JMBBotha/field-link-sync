import { supabase } from "@/integrations/supabase/client";

/**
 * Samsung AR40 "Digital Artist" sales cards.
 * Family: 9 / 12 / 18 / 24 kBTU only. No prices are rendered on the art.
 * Matches both slash (AR40F12C0AG/FA) and hyphen (AR40F12C0AG-FA) SKU variants.
 */

const BUCKET = "product-images";
const FOLDER = "ar40";

export const AR40_FAMILY_CARD = `${FOLDER}/AR40-family-sales-card.png`;

const SKU_CARDS: Record<string, string> = {
  "AR40F09C0AG-FA": `${FOLDER}/AR40F09C0AG-FA-sales-card.png`,
  "AR40F12C0AG-FA": `${FOLDER}/AR40F12C0AG-FA-sales-card.png`,
  "AR40F18C0AG-FA": `${FOLDER}/AR40F18C0AG-FA-sales-card.png`,
  "AR40F24C0AG-FA": `${FOLDER}/AR40F24C0AG-FA-sales-card.png`,
};

export function normaliseSku(code: string): string {
  return (code || "").toUpperCase().trim().replace(/\//g, "-").replace(/\s+/g, "");
}

export function isAr40Code(code: string): boolean {
  return normaliseSku(code).startsWith("AR40F");
}

export function storagePublicUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export interface SalesCard {
  code: string;
  label: string;
  url: string;
  isFamilyFallback: boolean;
}

/** Resolve one AR40 sales card for a product code; family card is the fallback. */
export function resolveAr40SalesCard(code: string): SalesCard | null {
  if (!isAr40Code(code)) return null;
  const key = normaliseSku(code);
  const path = SKU_CARDS[key];
  return {
    code: key,
    label: path ? `Samsung ${key}` : "Samsung AR40 Digital Artist",
    url: storagePublicUrl(path || AR40_FAMILY_CARD),
    isFamilyFallback: !path,
  };
}

/** Unique sales cards for a list of line-item product codes. */
export function resolveAr40SalesCards(codes: string[]): SalesCard[] {
  const seen = new Set<string>();
  const out: SalesCard[] = [];
  for (const code of codes) {
    const card = resolveAr40SalesCard(code);
    if (!card) continue;
    const dedupeKey = card.isFamilyFallback ? "family" : card.code;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(card);
  }
  return out;
}

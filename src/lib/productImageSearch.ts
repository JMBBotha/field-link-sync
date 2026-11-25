import { primaryModelCode } from "./modelCode";

/**
 * Pure rules for the one-time product photo lookup.
 * The edge function (find-product-image) is the only caller that talks to
 * the network. Prices are never part of these objects.
 */

export const PRODUCT_IMAGE_FIELDS = ["image_url", "image_source_url", "image_needs_review"] as const;

/** Official manufacturer and supplier hosts. Longer / more specific names score as a match on the hostname. */
export const PREFERRED_HOSTS = [
  "images.samsung.com",
  "samsung.com",
  "mideaaircon.co.za",
  "midea.com",
  "livanceair.co.za",
  "livance.co.za",
  "livance.com",
  "fourwaysairconditioning.co.za",
  "fourwaysaircon.co.za",
  "fourwaysgroup.co.za",
  "fourways.co.za",
  "daikin.co.za",
  "daikin.com",
  "daikinmea.com",
  "allianceair.co.za",
  "mitsubishielectric.co.za",
  "mitsubishielectric.com",
  "lg.com",
  "gree.com",
  "hisense.com",
  "carrier.com",
  "panasonic.com",
  "toshiba-aircon.co.za",
];

const REJECT_HOST_BITS = ["pinterest.", "facebook.", "instagram.", "tiktok.", "youtube.", "aliexpress.", "amazon.", "ebay.", "wikipedia."];

export interface ImageCandidate {
  url: string;
  page?: string | null;
  title?: string | null;
  /** Model the searcher claims this picture shows. */
  model?: string | null;
}

export interface ImageLinkState {
  productImageUrl?: string | null;
  mediaImageUrl?: string | null;
  /** Web page or file the current photo came from. Kept after a reject so the same URL is not saved again. */
  sourceUrl?: string | null;
  /** product_media.fetch_error for the image lookup (prefixed "image:"). Spec fetches use a different prefix. */
  fetchError?: string | null;
  needsReview?: boolean | null;
}

export type LookupDecision =
  | { action: "return"; reason: "already_linked" }
  | { action: "link_existing" }
  | { action: "search" }
  | { action: "skip"; reason: "rejected" | "in_progress" | "already_tried" };

/** Only the catalogue image columns. Any price key passed in is dropped. */
export function productImagePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PRODUCT_IMAGE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key];
  }
  return out;
}

/** Existing storage path: `{product id}.{ext}` in the product-images bucket. */
export function productImagePath(productId: string, ext = "png"): string {
  const clean = String(ext || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  return `${productId}.${clean === "jpeg" ? "jpg" : clean}`;
}

/** Full https public URL. Never a storage path and never a hotlink. */
export function productImagePublicUrl(supabaseUrl: string, productId: string, ext = "png"): string {
  const base = String(supabaseUrl || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/product-images/${productImagePath(productId, ext)}`;
}

export function isOwnProductImageUrl(url: string, supabaseUrl: string, productId: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    if (u.host !== base.host) return false;
    return u.pathname.includes(`/object/public/product-images/${productId}.`);
  } catch {
    return false;
  }
}

/**
 * POPIA: the only product text that may be sent to a search, vision, or image model.
 * Catalogue description stays inside Field Lynk. Client names, sites, phones, and prices never leave.
 */
export function outboundProductText(brand?: string | null, modelCode?: string | null): string {
  const b = String(brand || "").replace(/\s+/g, " ").trim();
  const m = String(modelCode || "").replace(/\s+/g, " ").trim();
  return [b, m].filter(Boolean).join(" ").slice(0, 180);
}

function flat(value: string): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when the text contains this model (phase notes and slashes ignored). */
export function candidateMentionsModel(text: string, modelCode: string): boolean {
  const key = flat(primaryModelCode(modelCode) || modelCode);
  if (key.length < 5) return false;
  return flat(text).includes(key);
}

const OTHER_CODE = /\b[A-Z][A-Z0-9][A-Z0-9/+-]{4,}\b/g;

/** True when the text names a different model code. Our own code does not count. */
export function candidateMentionsOtherModel(text: string, modelCode: string): boolean {
  const ours = flat(primaryModelCode(modelCode) || modelCode);
  if (!ours) return false;
  const found = String(text || "").toUpperCase().match(OTHER_CODE) || [];
  for (const raw of found) {
    const token = flat(raw);
    if (token.length < 6) continue;
    if (!/\d/.test(token)) continue;
    if (ours.includes(token) || token.includes(ours)) continue;
    return true;
  }
  return false;
}

export function hostScore(url: string, brand?: string | null): number {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return -1;
  }
  if (REJECT_HOST_BITS.some((bit) => host.includes(bit))) return -1;
  let score = 0;
  if (PREFERRED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) score += 50;
  const b = String(brand || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (b.length >= 3 && host.replace(/[^a-z0-9]/g, "").includes(b)) score += 30;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) score += 10;
  return score;
}

/** Samsung's image server returns a transparent PNG when asked for the PNG preset. */
export function cutoutCandidateUrl(url: string): string {
  if (/images\.samsung\.com\/is\/image\//i.test(url)) return url.split("?")[0] + "?$650_519_PNG$";
  return url;
}

/**
 * Prefer official domains, require this model, drop a different model and any URL
 * staff already rejected. Highest score first.
 */
export function rankImageCandidates(
  candidates: ImageCandidate[],
  opts: { modelCode: string; brand?: string | null; excludeUrl?: string | null },
): ImageCandidate[] {
  const exclude = String(opts.excludeUrl || "").split("?")[0];
  const scored: { item: ImageCandidate; score: number }[] = [];
  for (const item of candidates || []) {
    const url = String(item?.url || "").trim();
    if (!/^https:\/\//i.test(url)) continue;
    if (exclude && url.split("?")[0] === exclude) continue;
    const score = hostScore(url, opts.brand);
    if (score < 0) continue;
    const claimed = `${item.model || ""} ${item.title || ""}`;
    const urlHasOurs = candidateMentionsModel(url, opts.modelCode);
    const claimedOurs = candidateMentionsModel(claimed, opts.modelCode);
    const blob = `${url} ${claimed}`;
    if (candidateMentionsOtherModel(blob, opts.modelCode) && !urlHasOurs) continue;
    // An opaque CDN url is only kept when the searcher names our model AND the host is official.
    if (!urlHasOurs && !(claimedOurs && score >= 50)) continue;
    scored.push({ item: { ...item, url }, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((row) => row.item);
}

/**
 * Once a photo is linked, never search again.
 * A failed attempt or a staff reject waits for an explicit retry (the Find images button).
 */
export function lookupDecision(state: ImageLinkState, opts: { retry?: boolean } = {}): LookupDecision {
  const retry = opts.retry === true;
  if (state.productImageUrl) return { action: "return", reason: "already_linked" };
  if (state.mediaImageUrl) return { action: "link_existing" };
  if (state.fetchError === "image:fetching" && !retry) return { action: "skip", reason: "in_progress" };
  const rejected = !state.productImageUrl && !state.mediaImageUrl && !!state.sourceUrl && state.needsReview === false;
  if (rejected && !retry) return { action: "skip", reason: "rejected" };
  const tried = typeof state.fetchError === "string" && state.fetchError.startsWith("image:") && state.fetchError !== "image:fetching";
  if (tried && !retry) return { action: "skip", reason: "already_tried" };
  return { action: "search" };
}

/** PNG colour type 4 or 6 means the file has an alpha channel. */
export function isAlphaPng(bytes: Uint8Array): boolean {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 26 || !sig.every((v, i) => bytes[i] === v)) return false;
  return bytes[25] === 6 || bytes[25] === 4;
}

/** Pull a data-URL image out of a Lovable gateway chat completion, if one came back. */
export function imageDataUrlFromGateway(payload: unknown): string | null {
  const message = (payload as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message;
  if (!message) return null;
  const lists = [message.images, message.content];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const part of list) {
      const url = part?.image_url?.url || part?.url;
      if (typeof url === "string" && url.startsWith("data:image/")) return url;
    }
  }
  return null;
}

export function parseDataImage(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || "").trim());
  if (!match) return null;
  try {
    const bin = atob(match[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 32) return null;
    const mime = match[1].toLowerCase() === "image/jpeg" ? "image/jpeg" : match[1].toLowerCase();
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** Vision reply: { "match": true } keeps the photo. Anything else, including junk, rejects it. */
export function visionSaysMatch(text: string): boolean {
  const raw = String(text || "").replace(/```json|```/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed?.match === true;
  } catch {
    return false;
  }
}

import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { linesMissingUnitImages, missingUnitImageMessage, type MissingUnitImage } from "@/lib/quoteUnitImages";

export type FindImageResult = {
  product_id: string;
  status: string;
  image_url?: string | null;
  source_url?: string | null;
  needs_review?: boolean;
  reason?: string | null;
  error?: string | null;
  background?: string | null;
};

const inflight = new Map<string, Promise<FindImageResult>>();
const pendingIds = new Set<string>();
let pendingSnapshot = new Set<string>();
const pendingListeners = new Set<() => void>();

function publishPending() {
  pendingSnapshot = new Set(pendingIds);
  pendingListeners.forEach((listener) => listener());
}

function setPending(productId: string, on: boolean) {
  if (on) pendingIds.add(productId);
  else pendingIds.delete(productId);
  publishPending();
}

/** Product ids whose photo lookup is still running. */
export function usePendingProductImages(): Set<string> {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    () => pendingSnapshot,
    () => pendingSnapshot,
  );
}

export function isProductImagePending(productId: string | null | undefined): boolean {
  return !!productId && pendingSnapshot.has(productId);
}

async function invoke(body: Record<string, unknown>): Promise<FindImageResult> {
  const call = supabase.functions?.invoke;
  if (!call) return { product_id: String(body.product_id || ""), status: "error", error: "Image lookup is not available" };
  const { data, error } = await call("find-product-image", { body });
  if (error) {
    return { product_id: String(body.product_id || ""), status: "error", error: error.message || "Image lookup failed" };
  }
  const row = (data as { results?: FindImageResult[] } | null)?.results?.[0] ?? (data as FindImageResult | null);
  if (row?.product_id) return row;
  return { product_id: String(body.product_id || ""), status: "error", error: "No result" };
}

/** One lookup per product at a time. retry is only for the Find images button. */
export function requestProductImage(productId: string, opts: { retry?: boolean } = {}): Promise<FindImageResult> {
  const key = `${productId}:${opts.retry ? "retry" : "once"}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  setPending(productId, true);
  const task = invoke({ product_id: productId, retry: opts.retry === true }).finally(() => {
    inflight.delete(key);
    setPending(productId, false);
  });
  inflight.set(key, task);
  return task;
}

export async function requestProductImages(productIds: string[], opts: { retry?: boolean } = {}): Promise<FindImageResult[]> {
  const out: FindImageResult[] = [];
  for (const id of [...new Set(productIds.filter(Boolean))]) out.push(await requestProductImage(id, opts));
  return out;
}

export async function reviewProductImage(productId: string, action: "keep" | "reject" | "replace", imageUrl?: string | null) {
  const result = await invoke({ action, product_id: productId, image_url: imageUrl || undefined });
  if (result.status === "error") throw new Error(result.error || "Could not update the photo");
  return result;
}

/** Staff photo replaces a found one. Stored in product-images as `{id}.{ext}`, then linked. Prices are not touched. */
export async function uploadReplacementImage(productId: string, file: File) {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${productId}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
  if (error) throw error;
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return reviewProductImage(productId, "replace", data.publicUrl);
}

export async function fetchMissingUnitImages(quoteId: string): Promise<MissingUnitImage[]> {
  const { data: lines, error } = await supabase.from("quote_items").select("id, item_name, item_type, item_number, is_bundle, metadata, product_id").eq("quote_id", quoteId);
  if (error) throw error;
  const ids = [...new Set((lines || []).map((line) => line.product_id).filter((id): id is string => !!id))];
  let products: { id: string; image_url: string | null; product_category?: string | null; category?: string | null; subcategory?: string | null; product_type?: string | null; unit_type?: string | null; capacity_btu?: number | null; btu_rating?: number | null; kw?: number | null }[] = [];
  if (ids.length) {
    const { data, error: productError } = await supabase.from("supplier_products").select("id, image_url, product_category, category, subcategory, product_type, unit_type, capacity_btu, btu_rating, kw").in("id", ids);
    if (productError) throw productError;
    products = data || [];
  }
  return linesMissingUnitImages(lines || [], products);
}

export class QuoteUnitImagesError extends Error {
  missing: MissingUnitImage[];
  constructor(missing: MissingUnitImage[]) {
    super(missingUnitImageMessage(missing.map((row) => row.name)));
    this.name = "QuoteUnitImagesError";
    this.missing = missing;
  }
}

export async function assertQuoteUnitImages(quoteId: string): Promise<void> {
  const missing = await fetchMissingUnitImages(quoteId);
  if (missing.length) throw new QuoteUnitImagesError(missing);
}

export { missingUnitImageMessage };

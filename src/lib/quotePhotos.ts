import { supabase } from "@/integrations/supabase/client";

/**
 * quote-photos is a PRIVATE bucket (2026-10-12). Never use getPublicUrl on it.
 * Objects live under `{company_id}/...` (storage RLS keys on that prefix).
 * Section images are stored in JSON as a ref `quote-photos:<path>` and signed on display.
 */
export const QUOTE_PHOTO_PREFIX = "quote-photos:";

export async function quotePhotoFolder(): Promise<string> {
  const { data, error } = await supabase.rpc("caller_company_id" as any);
  if (error || !data) throw new Error("Could not resolve your company for photo upload");
  return String(data);
}

export function quotePhotoRef(path: string): string {
  return `${QUOTE_PHOTO_PREFIX}${path}`;
}

/** Returns the storage path for a ref or a legacy public quote-photos URL; null for anything else. */
export function quotePhotoPath(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith(QUOTE_PHOTO_PREFIX)) return src.slice(QUOTE_PHOTO_PREFIX.length);
  const m = src.match(/\/storage\/v1\/object\/(?:public|sign)\/quote-photos\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function signedQuotePhotoUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from("quote-photos").createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

/** Resolve any image src: quote-photos refs/legacy URLs get signed; other URLs pass through. */
export async function resolveQuotePhotoSrc(src: string): Promise<string> {
  const path = quotePhotoPath(src);
  return path ? signedQuotePhotoUrl(path) : src;
}

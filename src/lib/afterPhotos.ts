/**
 * Johan 23 Oct 19:01 — "photos and sign off required for the day's work".
 * Every closed day (multi-day "Done for today") and every finished job needs >= 1 after photo taken that day and the
 * tech's own sign-off (his name; the time is recorded). A client signature is optional. The server enforces the same
 * rule (tech_done_for_today + the job_completions trigger); these helpers keep the UI in step, also offline.
 */
import { supabase } from "@/integrations/supabase/client";
import { offlineDb } from "@/lib/offlineDb";

const ms = (since?: string | null) => (since ? new Date(since).getTime() : 0);

/** After photos still on this device for the lead (taken since `since`). `pending` = not uploaded yet. */
export async function localAfterPhotos(leadId: string, since?: string | null): Promise<{ all: number; pending: number }> {
  try {
    const rows = (await offlineDb.getPhotosForLead(leadId)).filter((p) => p.photoType === "after" && p.capturedAt >= ms(since) && !p.markedForDeletion);
    return { all: rows.length, pending: rows.filter((p) => !p.uploaded).length };
  } catch {
    return { all: 0, pending: 0 };
  }
}

/** After photos the server has for the lead since `since` (the day's check-in on multi-day jobs). */
export async function serverAfterPhotos(leadId: string, since?: string | null): Promise<number> {
  let q = supabase.from("job_photos" as never).select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("photo_type", "after");
  if (since) q = q.gte("created_at", since);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** What the tech has for today: online = server + not-yet-uploaded; offline = what is on the device. */
export async function countAfterPhotos(leadId: string, since: string | null | undefined, online: boolean): Promise<number> {
  const local = await localAfterPhotos(leadId, since);
  if (!online) return local.all;
  return (await serverAfterPhotos(leadId, since)) + local.pending;
}

/**
 * Before closing a day / finishing online: push queued photo uploads first so the server sees them.
 * Returns false when photos are still waiting (then the caller queues the close behind them or asks to retry).
 */
export async function flushAfterPhotos(leadId: string, sync: () => Promise<void>): Promise<boolean> {
  if ((await localAfterPhotos(leadId)).pending === 0) return true;
  try { await sync(); } catch { /* checked below */ }
  return (await localAfterPhotos(leadId)).pending === 0;
}

export const MIN_SIGNOFF_NAME = 2;

/** The one message the sheets show while the day can't be closed yet (null = ready). */
export function signOffError(a: { photos: number; confirmed: boolean; name: string; what?: "day" | "job" }): string | null {
  if (a.photos < 1) return a.what === "job" ? "Take at least one after photo first." : "Take at least one after photo of today's work.";
  if (a.name.trim().length < MIN_SIGNOFF_NAME) return "Type your name to sign off.";
  if (!a.confirmed) return a.what === "job" ? "Tick to sign off the job." : "Tick to sign off today's work.";
  return null;
}

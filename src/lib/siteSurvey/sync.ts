import { supabase } from "@/integrations/supabase/client";
import { mediaRow, roomRow, surveyRow, type SurveyDraft } from "./model";
import { markUploaded, pendingBlobs } from "./store";

export const SURVEY_BUCKET = "site-surveys";
const sb = () => supabase as any;

export interface SyncResult { ok: boolean; uploaded: number; error?: string; draft: SurveyDraft }

/**
 * Push a phone draft to the server. Idempotent: ids are made on the phone, rows are upserted,
 * files are uploaded with upsert. Order: survey -> rooms -> files -> media rows -> deletes.
 */
export async function syncDraft(d: SurveyDraft): Promise<SyncResult> {
  const rev = d.rev;
  let uploaded = 0;
  try {
    // insert once, then plain updates (an admin may edit a rep's survey; created_by/lead stay the original)
    const row = surveyRow(d);
    let r: any = d.syncedRev === 0 ? await sb().from("site_surveys").insert(row) : { error: { code: "23505" } };
    if (r.error?.code === "23505") {
      const { id, lead_id, created_by, ...upd } = row;
      r = await sb().from("site_surveys").update(upd).eq("id", id);
    }
    if (r.error) throw r.error;
    if (d.rooms.length) {
      r = await sb().from("site_survey_rooms").upsert(d.rooms.map((x) => roomRow(d, x)), { onConflict: "id" });
      if (r.error) throw r.error;
    }
    for (const b of await pendingBlobs(d.id)) {
      const up = await supabase.storage.from(SURVEY_BUCKET).upload(b.path, b.blob, { contentType: b.contentType, upsert: true });
      if (up.error) throw up.error;
      await markUploaded(b.path); uploaded++;
    }
    const photos = d.media.filter((m) => m.kind !== "audio"), audio = d.media.filter((m) => m.kind === "audio");
    for (const set of [photos, audio]) {
      if (!set.length) continue;
      r = await sb().from("site_survey_media").upsert(set.map((m) => mediaRow(d, m)), { onConflict: "id" });
      if (r.error) throw r.error;
    }
    if (d.deletedMediaIds.length) {
      r = await sb().from("site_survey_media").delete().in("id", d.deletedMediaIds);
      if (r.error) throw r.error;
    }
    if (d.deletedRoomIds.length) {
      r = await sb().from("site_survey_rooms").delete().in("id", d.deletedRoomIds);
      if (r.error) throw r.error;
    }
    const s = await sb().from("site_surveys").select("report_no, status").eq("id", d.id).maybeSingle();
    const next: SurveyDraft = { ...d, report_no: s.data?.report_no ?? d.report_no, deletedMediaIds: [], deletedRoomIds: [],
      media: d.media.map((m) => ({ ...m, synced: true })), syncedRev: rev };
    return { ok: true, uploaded, draft: next };
  } catch (e: any) {
    return { ok: false, uploaded, error: e?.message ?? String(e), draft: d };
  }
}

export async function fetchServerSurvey(leadId: string) {
  const s = await sb().from("site_surveys").select("*").eq("lead_id", leadId).is("archived_at", null).maybeSingle();
  if (s.error) throw s.error;
  if (!s.data) return null;
  const [rooms, media] = await Promise.all([
    sb().from("site_survey_rooms").select("*").eq("survey_id", s.data.id),
    sb().from("site_survey_media").select("*").eq("survey_id", s.data.id),
  ]);
  if (rooms.error) throw rooms.error;
  if (media.error) throw media.error;
  return { survey: s.data, rooms: rooms.data ?? [], media: media.data ?? [] };
}

export async function signedSurveyUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(SURVEY_BUCKET).createSignedUrl(path, seconds);
  return error || !data?.signedUrl ? "" : data.signedUrl;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  draftFromServer, mediaPath, newDraft, uuid,
  type MediaKind, type SurveyDraft, type SurveyMedia,
} from "@/lib/siteSurvey/model";
import { draftForLead, getBlob, putBlob, saveDraft } from "@/lib/siteSurvey/store";
import { fetchServerSurvey, signedSurveyUrl, syncDraft } from "@/lib/siteSurvey/sync";
import { compressPhoto } from "@/lib/siteSurvey/media";

export type SyncState = "saved-phone" | "syncing" | "synced" | "error";

/** Rep site survey for one lead: phone draft first (works offline), synced to the server when there is signal. */
export function useSiteSurvey(leadId: string | undefined) {
  const { user } = useAuth();
  const { isOnline } = useOnlineStatus() as { isOnline: boolean };
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>("synced");
  const [syncError, setSyncError] = useState<string | null>(null);
  const ref = useRef<SurveyDraft | null>(null);
  ref.current = draft;
  const syncing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!leadId || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const local = await draftForLead(leadId);
        let server: Awaited<ReturnType<typeof fetchServerSurvey>> = null;
        if (navigator.onLine) { try { server = await fetchServerSurvey(leadId); } catch { /* offline-ish: use local */ } }
        let d: SurveyDraft | null = null;
        if (local && (local.rev > local.syncedRev || !server)) d = local;          // unsynced phone edits win
        else if (server) d = draftFromServer(server.survey, server.rooms, server.media);
        if (!d) {
          const { data: lead, error: le } = await (supabase.from("leads") as any).select("company_id, latitude, longitude").eq("id", leadId).maybeSingle();
          if (le) throw le;
          if (!lead?.company_id) throw new Error("This visit has no company linked yet.");
          d = { ...newDraft(leadId, lead.company_id, user.id), lat: lead.latitude ?? null, lng: lead.longitude ?? null };
          d.syncedRev = 0; d.rev = 0;
        }
        await saveDraft(d);
        if (!cancelled) { setDraft(d); setSync(d.rev > d.syncedRev ? "saved-phone" : "synced"); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [leadId, user?.id]);

  const runSyncRef = useRef<(() => Promise<void>) | null>(null);
  const runSync = useCallback(async () => {
    const d = ref.current;
    if (!d || syncing.current || d.rev <= d.syncedRev || !navigator.onLine) return;
    syncing.current = true; setSync("syncing");
    const res = await syncDraft(d);
    syncing.current = false;
    if (res.ok) {
      // keep newer local edits made while syncing
      const cur = ref.current ?? res.draft;
      const merged: SurveyDraft = cur.rev > d.rev
        ? { ...cur, syncedRev: d.rev, report_no: res.draft.report_no ?? cur.report_no,
            media: cur.media.map((m) => (d.media.some((x) => x.id === m.id) ? { ...m, synced: true } : m)),
            deletedMediaIds: cur.deletedMediaIds.filter((x) => !d.deletedMediaIds.includes(x)),
            deletedRoomIds: cur.deletedRoomIds.filter((x) => !d.deletedRoomIds.includes(x)) }
        : { ...res.draft, syncedRev: d.rev };
      ref.current = merged;
      setDraft(merged);
      await saveDraft(merged);
      setSyncError(null);
      setSync(merged.rev > merged.syncedRev ? "saved-phone" : "synced");
      if (merged.rev > merged.syncedRev) setTimeout(() => { void runSyncRef.current?.(); }, 1200);
    } else { setSync("error"); setSyncError(res.error ?? "Upload failed"); }
  }, []);

  runSyncRef.current = runSync;
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void runSync(); }, 1200);
  }, [runSync]);

  useEffect(() => { if (isOnline) schedule(); }, [isOnline, schedule]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Apply a change, save it on the phone at once, then sync in the background. */
  const update = useCallback((fn: (d: SurveyDraft) => SurveyDraft) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = { ...fn(cur), rev: cur.rev + 1 };
      ref.current = next;
      void saveDraft(next);
      return next;
    });
    setSync("saved-phone");
    schedule();
  }, [schedule]);

  const addPhoto = useCallback(async (file: File | Blob, kind: Exclude<MediaKind, "audio">, roomId: string | null, replaceId?: string) => {
    const d = ref.current; if (!d) return null;
    const blob = await compressPhoto(file);
    const id = uuid();
    const path = mediaPath(d, id, "jpg");
    await putBlob(d.id, path, blob, "image/jpeg");
    const m: SurveyMedia = { id, room_id: kind === "front" ? null : roomId, parent_media_id: null, kind, storage_path: path,
      annotated_path: null, annotation: null, caption: null, transcript: null, transcript_status: "none", duration_s: null,
      bytes: blob.size, sort: Date.now() % 2147483647, taken_at: new Date().toISOString(), synced: false };
    update((x) => {
      const drop = replaceId ? x.media.filter((y) => y.id === replaceId || y.parent_media_id === replaceId).map((y) => y.id) : [];
      return { ...x, media: [...x.media.filter((y) => !drop.includes(y.id)), m],
        deletedMediaIds: [...x.deletedMediaIds, ...drop.filter((i) => x.media.find((y) => y.id === i)?.synced)] };
    });
    return m;
  }, [update]);

  const saveAnnotation = useCallback(async (mediaId: string, annotation: unknown, jpeg: Blob) => {
    const d = ref.current; if (!d) return;
    const path = mediaPath(d, mediaId, "jpg", `-annotated-${Date.now().toString(36)}`);
    await putBlob(d.id, path, jpeg, "image/jpeg");
    update((x) => ({ ...x, media: x.media.map((m) => (m.id === mediaId ? { ...m, annotation, annotated_path: path } : m)) }));
  }, [update]);

  const removeMedia = useCallback((mediaId: string) => {
    update((x) => {
      const ids = x.media.filter((m) => m.id === mediaId || m.parent_media_id === mediaId).map((m) => m.id);
      return { ...x, media: x.media.filter((m) => !ids.includes(m.id)),
        deletedMediaIds: [...x.deletedMediaIds, ...ids.filter((i) => x.media.find((m) => m.id === i)?.synced)] };
    });
  }, [update]);

  return { draft, loading, error, sync, syncError, isOnline, update, addPhoto, saveAnnotation, removeMedia, syncNow: runSync };
}

/** Display URL for a survey file: the phone copy if it's still here, else a short-lived signed URL. */
export function useSurveyFileUrl(path: string | null | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) { setUrl(""); return; }
    let obj = ""; let cancelled = false;
    (async () => {
      const b = await getBlob(path);
      if (b) { obj = URL.createObjectURL(b.blob); if (!cancelled) setUrl(obj); return; }
      const s = await signedSurveyUrl(path);
      if (!cancelled) setUrl(s);
    })();
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [path]);
  return url;
}

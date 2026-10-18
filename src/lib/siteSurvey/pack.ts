/** Read-only survey "job pack" for the tech: server first, phone copy when there is no signal. */
import { draftFromServer, type SurveyDraft } from "./model";
import { fetchServerSurvey, signedSurveyUrl } from "./sync";
import { getBlob, surveyDb } from "./store";

const KEY = (leadId: string) => `fls.surveyPack.${leadId}`;

export async function loadSurveyPack(leadId: string): Promise<SurveyDraft | null> {
  try {
    const s = await fetchServerSurvey(leadId);
    const d = s ? draftFromServer(s.survey, s.rooms, s.media) : null;
    try { localStorage.setItem(KEY(leadId), JSON.stringify(d)); } catch { /* storage full: still works online */ }
    return d;
  } catch (e) {
    const cached = readCachedPack(leadId);
    if (cached !== undefined) return cached;
    throw e;
  }
}

export function readCachedPack(leadId: string): SurveyDraft | null | undefined {
  try { const raw = localStorage.getItem(KEY(leadId)); return raw == null ? undefined : (JSON.parse(raw) as SurveyDraft | null); } catch { return undefined; }
}

/** Keep the photos (annotated copy preferred) + front photo on the phone so the pack opens without signal. */
export async function cachePackFiles(d: SurveyDraft): Promise<number> {
  let n = 0;
  for (const m of d.media) {
    if (m.kind === "audio") continue;
    const path = m.annotated_path || m.storage_path;
    if (!path || (await getBlob(path))) continue;
    const url = await signedSurveyUrl(path);
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      await surveyDb.blobs.put({ path, surveyId: d.id, blob, contentType: blob.type || "image/jpeg", uploaded: 1, createdAt: Date.now() });
      n++;
    } catch { /* next time */ }
  }
  return n;
}

/** One-line pipe summary for a card: "Main bedroom 3.5 m · Lounge 6 m". */
export function pipeSummary(d: SurveyDraft | null | undefined): { name: string; m: number | null }[] {
  return (d?.rooms ?? []).map((r) => ({ name: r.name, m: r.pipe_run_m }));
}

const WALL_TO_CHECK: Record<string, string> = { "Face brick": "Face brick", Concrete: "Concrete", Drywall: "Dry-wall", "Wood / cladding": "Other" };

/** Site check hints from the survey: one wall type when all rooms agree; pipe metres by room name (lower-case). */
export function siteCheckHints(d: SurveyDraft | null | undefined): { wall: string | null; pipeByRoom: Record<string, number> } | null {
  if (!d || !d.rooms.length) return null;
  const walls = [...new Set(d.rooms.map((r) => r.wall_type).filter(Boolean) as string[])];
  const pipeByRoom: Record<string, number> = {};
  for (const r of d.rooms) if (r.pipe_run_m != null) pipeByRoom[r.name.trim().toLowerCase()] = r.pipe_run_m;
  return { wall: walls.length === 1 ? WALL_TO_CHECK[walls[0]] ?? null : null, pipeByRoom };
}

import Dexie, { type Table } from "dexie";
import type { SurveyDraft } from "./model";

/** Phone-side store for survey drafts + not-yet-uploaded files (photos, annotated copies, audio). */
export interface SurveyBlob { path: string; surveyId: string; blob: Blob; contentType: string; uploaded: 0 | 1; createdAt: number }

class SurveyDb extends Dexie {
  drafts!: Table<SurveyDraft, string>;
  blobs!: Table<SurveyBlob, string>;
  constructor() {
    super("fls-site-survey");
    this.version(1).stores({ drafts: "id, leadId, updatedAt", blobs: "path, surveyId, uploaded" });
  }
}
export const surveyDb = new SurveyDb();

export async function saveDraft(d: SurveyDraft) { await surveyDb.drafts.put({ ...d, updatedAt: Date.now() }); }
export async function draftForLead(leadId: string) {
  const all = await surveyDb.drafts.where("leadId").equals(leadId).toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}
export async function putBlob(surveyId: string, path: string, blob: Blob, contentType: string) {
  await surveyDb.blobs.put({ path, surveyId, blob, contentType, uploaded: 0, createdAt: Date.now() });
}
export async function getBlob(path: string) { return (await surveyDb.blobs.get(path)) ?? null; }
export async function pendingBlobs(surveyId: string) {
  return surveyDb.blobs.where("surveyId").equals(surveyId).filter((b) => b.uploaded === 0).toArray();
}
export async function markUploaded(path: string) { await surveyDb.blobs.update(path, { uploaded: 1 }); }

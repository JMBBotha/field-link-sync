/**
 * Builds the job / warranty card PDF, stores it in the private job-cards bucket,
 * and links it to the job and client. Auto-email runs only when the company
 * switch is on. The switch defaults off, and the edge function checks it again.
 */
import logoLight from "@/assets/brand/logo-light.png";
import { supabase } from "@/integrations/supabase/client";
import { MASSAIR_CT_LEGAL_NAME, JOB_CARD_BUCKET, buildJobCard, jobCardStoragePath, type JobCardMaterialInput } from "@/lib/jobCard";
import { loadJobCardFacts } from "@/lib/jobCardLoad";
import { renderJobCardPdf } from "@/lib/jobCardPdf";

export interface IssueJobCardInput {
  jobId: string;
  leadId: string;
  workSummary: string;
  clientName?: string | null;
  signatureDataUrl?: string | null;
  signerName?: string | null;
  techName: string;
  completedAt: string;
  labourMinutes?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  extras?: JobCardMaterialInput[];
}

export type IssueJobCardResult =
  | { ok: true; cardId: string | null; path: string; emailed: boolean; reason: string }
  | { ok: false; reason: string };

async function massairLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(logoLight);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export async function issueJobCard(input: IssueJobCardInput): Promise<IssueJobCardResult> {
  if (!input.jobId) return { ok: false, reason: "no_job" };
  try {
    const facts = await loadJobCardFacts(input.jobId, input.leadId, { includePhotoBytes: true });
    const times = facts.times.length
      ? facts.times
      : [{ start: input.startedAt, end: input.finishedAt, minutes: input.labourMinutes }];
    const model = buildJobCard({
      company: facts.company,
      clientName: input.clientName,
      clientVat: facts.clientVat,
      siteAddress: facts.siteAddress,
      jobTitle: facts.jobTitle,
      jobType: facts.jobType,
      jobDates: [...facts.jobDates, input.completedAt, input.startedAt],
      completedAt: input.completedAt,
      workDone: input.workSummary,
      units: facts.units,
      photos: facts.photos.map((p) => ({ label: p.label, caption: p.caption, dataUrl: p.dataUrl })),
      materials: [...facts.materials, ...(input.extras || [])],
      times,
      labourMinutes: input.labourMinutes,
      technicianName: input.techName,
      signatureDataUrl: input.signatureDataUrl,
      signerName: input.signerName,
    });
    const logo = model.company.legalName === MASSAIR_CT_LEGAL_NAME ? await massairLogoDataUrl() : null;
    const bytes = renderJobCardPdf(model, logo);
    const companyId = facts.companyId;
    if (!companyId) return { ok: false, reason: "no_company" };
    const path = jobCardStoragePath(companyId, input.jobId);
    const storage = (supabase as any).storage;
    if (!storage?.from) return { ok: false, reason: "storage_unavailable" };
    const upload = await storage.from(JOB_CARD_BUCKET).upload(path, new Blob([bytes], { type: "application/pdf" }), {
      upsert: true,
      contentType: "application/pdf",
    });
    if (upload?.error) return { ok: false, reason: "upload_failed" };

    let userId: string | null = null;
    try {
      const auth = (supabase as any).auth;
      if (auth?.getUser) userId = (await auth.getUser())?.data?.user?.id ?? null;
    } catch {
      userId = null;
    }

    const row = {
      company_id: companyId,
      job_id: input.jobId,
      customer_id: facts.customerId,
      lead_id: input.leadId,
      storage_path: path,
      signed: model.signed,
      client_name: model.clientName,
      signed_at: model.signed ? input.completedAt : null,
      completed_at: input.completedAt,
      technician_name: model.technicianName,
      work_summary: model.workDone,
      issued_by: userId,
    };
    let cardId: string | null = null;
    try {
      const saved = await (supabase.from as any)("job_cards").upsert(row, { onConflict: "job_id" }).select("id");
      const data = saved?.data;
      cardId = Array.isArray(data) ? data[0]?.id ?? null : data?.id ?? null;
      if (saved?.error) return { ok: false, reason: "link_failed" };
    } catch {
      return { ok: false, reason: "link_failed" };
    }

    let emailed = false;
    let reason = "auto_send_off";
    if (facts.autoSend === true && cardId) {
      try {
        const fns = (supabase as any).functions;
        if (fns?.invoke) {
          const sent = await fns.invoke("send-job-card", { body: { job_card_id: cardId } });
          emailed = sent?.data?.sent === true;
          reason = String(sent?.data?.reason || (emailed ? "sent" : "not_sent"));
        } else {
          reason = "send_unavailable";
        }
      } catch {
        reason = "send_unavailable";
      }
    }
    return { ok: true, cardId, path, emailed, reason };
  } catch {
    return { ok: false, reason: "card_failed" };
  }
}

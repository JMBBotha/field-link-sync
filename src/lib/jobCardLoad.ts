/**
 * Reads the job, client, units, photos, materials and times for a job / warranty card.
 * Photos chosen for the card get a short-lived signed URL. Prices are never selected.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchCompanyProfiles, type CompanyProfile } from "@/lib/companyProfiles";
import {
  DEFAULT_JOB_CARD_PHOTO_MODE,
  JOB_CARD_PHOTO_URL_SECONDS,
  companyForJobCard,
  normalisePhotoMode,
  photoKindLabel,
  pickJobCardProfile,
  selectJobCardPhotos,
  type JobCardCompany,
  type JobCardMaterialInput,
  type JobCardPhotoMode,
  type JobCardTimeInput,
  type JobCardUnitInput,
} from "@/lib/jobCard";

export interface JobCardFacts {
  companyId: string | null;
  customerId: string | null;
  company: JobCardCompany;
  clientVat: string | null;
  clientEmail: string | null;
  siteAddress: string | null;
  jobTitle: string | null;
  jobType: string | null;
  jobDates: string[];
  units: JobCardUnitInput[];
  photos: { label: string; caption: string | null; dataUrl: string | null; path: string | null }[];
  materials: JobCardMaterialInput[];
  times: JobCardTimeInput[];
  photoMode: JobCardPhotoMode;
  autoSend: boolean;
}

async function many(table: string, column: string, id: string, select: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await (supabase.from as any)(table).select(select).eq(column, id);
    if (!res || res.error || !Array.isArray(res.data)) return [];
    return res.data as Record<string, unknown>[];
  } catch {
    return [];
  }
}

async function first(table: string, column: string, id: string, select: string): Promise<Record<string, unknown> | null> {
  const rows = await many(table, column, id, select);
  return rows[0] ?? null;
}

const s = (v: unknown) => String(v ?? "").trim();

export async function loadJobCardFacts(jobId: string, leadId?: string | null, opts?: { includePhotoBytes?: boolean }): Promise<JobCardFacts> {
  const emptyCompany = companyForJobCard(null, null);
  const blank: JobCardFacts = {
    companyId: null,
    customerId: null,
    company: emptyCompany,
    clientVat: null,
    clientEmail: null,
    siteAddress: null,
    jobTitle: null,
    jobType: null,
    jobDates: [],
    units: [],
    photos: [],
    materials: [],
    times: [],
    photoMode: DEFAULT_JOB_CARD_PHOTO_MODE,
    autoSend: false,
  };
  if (!jobId) return blank;

  const job = await first("jobs", "id", jobId, "id, company_id, customer_id, lead_id, title, job_type, address, scheduled_for, completed_at");
  const companyId = s(job?.company_id) || null;
  const customerId = s(job?.customer_id) || null;
  const lead = s(job?.lead_id) || leadId || null;

  let profiles: CompanyProfile[] = [];
  try {
    profiles = await fetchCompanyProfiles();
  } catch {
    profiles = [];
  }
  const own = companyId ? profiles.filter((p) => !p.company_id || p.company_id === companyId) : profiles;
  const company = companyForJobCard(pickJobCardProfile(own), companyId);

  let photoMode = DEFAULT_JOB_CARD_PHOTO_MODE;
  let autoSend = false;
  if (companyId) {
    const flags = await first("companies", "id", companyId, "auto_send_job_card, job_card_photo_mode");
    autoSend = flags?.auto_send_job_card === true;
    photoMode = normalisePhotoMode(flags?.job_card_photo_mode);
  }

  let clientVat: string | null = null;
  let clientEmail: string | null = null;
  if (customerId) {
    const customer = await first("customers", "id", customerId, "vat_number, email, company_id");
    const customerCompany = s(customer?.company_id);
    // A blank company on an older client still belongs to this job. A different company does not.
    if (customer && (!companyId || !customerCompany || customerCompany === companyId)) {
      clientVat = s(customer.vat_number) || null;
      clientEmail = s(customer.email) || null;
    }
  }

  const unitRows = await many("job_unit_details", "job_id", jobId, "unit_label, position, brand, model, serial_number");
  const units: JobCardUnitInput[] = unitRows.map((u) => ({
    label: s(u.unit_label) || null,
    position: s(u.position) || null,
    brand: s(u.brand) || null,
    model: s(u.model) || null,
    serial: s(u.serial_number) || null,
  }));

  const materialRows = await many("job_materials_used", "job_id", jobId, "item, qty");
  const materials: JobCardMaterialInput[] = materialRows.map((m) => ({ item: s(m.item), qty: Number(m.qty) || 0 }));

  const timeRows = lead
    ? await many("job_time_entries", "lead_id", lead, "start_time, end_time, hours_onsite, work_date, job_id")
    : [];
  const times: JobCardTimeInput[] = timeRows
    .filter((t) => !t.job_id || s(t.job_id) === jobId)
    .map((t) => ({
      start: s(t.start_time) || (s(t.work_date) ? `${s(t.work_date)}T00:00:00+02:00` : null),
      end: s(t.end_time) || null,
      minutes: t.hours_onsite != null ? Math.round(Number(t.hours_onsite) * 60) : null,
    }));

  const dates = [
    s(job?.scheduled_for),
    s(job?.completed_at),
    ...timeRows.map((t) => s(t.work_date)),
    ...times.map((t) => t.start || ""),
  ].filter(Boolean);

  let photos: JobCardFacts["photos"] = [];
  if (lead) {
    const photoRows = await many("job_photos", "lead_id", lead, "photo_type, client_visible, storage_path, annotated_path, caption");
    const chosen = selectJobCardPhotos(
      photoRows.map((p) => ({
        client_visible: p.client_visible === true,
        photo_type: s(p.photo_type) || null,
        caption: s(p.caption) || null,
        storage_path: s(p.storage_path),
        annotated_path: s(p.annotated_path),
      })),
      photoMode,
    ).slice(0, 6);
    photos = [];
    for (const p of chosen) {
      const path = p.annotated_path || p.storage_path || null;
      let dataUrl: string | null = null;
      if (path && opts?.includePhotoBytes !== false) dataUrl = await photoDataUrl(path);
      photos.push({ label: photoKindLabel(p.photo_type), caption: p.caption, dataUrl, path });
    }
  }

  return {
    companyId,
    customerId,
    company,
    clientVat,
    clientEmail,
    siteAddress: s(job?.address) || null,
    jobTitle: s(job?.title) || null,
    jobType: s(job?.job_type) || null,
    jobDates: dates,
    units,
    photos,
    materials,
    times,
    photoMode,
    autoSend,
  };
}

/** Fetch a private job photo and shrink it. The signed URL lasts JOB_CARD_PHOTO_URL_SECONDS. */
export async function photoDataUrl(path: string): Promise<string | null> {
  try {
    const storage = (supabase as any).storage;
    if (!storage?.from) return null;
    const signed = await storage.from("job-photos").createSignedUrl(path, JOB_CARD_PHOTO_URL_SECONDS);
    const url = signed?.data?.signedUrl as string | undefined;
    if (!url || typeof document === "undefined") return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const maxW = 640;
    const scale = Math.min(1, maxW / Math.max(1, bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

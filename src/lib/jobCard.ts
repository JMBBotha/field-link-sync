/**
 * Job / warranty card. Filled from the job when the technician finishes.
 * Warranty sentences come from the quote/invoice terms (installedUnitWarrantyLines).
 * Materials are names and quantities only. No prices, no gas or pressure readings.
 */
import { COMPANY } from "@/lib/companyIdentity";
import { profileIdentity, type CompanyProfile } from "@/lib/companyProfiles";
import { WARRANTY_EXCLUSIONS, installedUnitWarrantyLines } from "@/lib/defaultTerms";
import { jobTypeLabel } from "@/lib/jobTypes";

export const MASSAIR_CT_LEGAL_NAME = "Massair CT (Pty) Ltd";
export const JOB_CARD_BUCKET = "job-cards";
export const JOB_CARD_FILE = "job-card.pdf";
/** Signed photo links used while the PDF is built. They are not stored on the card. */
export const JOB_CARD_PHOTO_URL_SECONDS = 120;
export const LABOUR_WARRANTY_MONTHS = 12;
export const UNSIGNED_CLIENT = "Not signed by client";
export const JOB_CARD_POPIA =
  "I confirm the work was done as described, I have read the warranty terms, and I agree these photos are kept as the record of this job.";

export const JOB_CARD_PHOTO_MODES = ["client_visible_else_after", "client_visible_only"] as const;
export type JobCardPhotoMode = (typeof JOB_CARD_PHOTO_MODES)[number];
export const DEFAULT_JOB_CARD_PHOTO_MODE: JobCardPhotoMode = "client_visible_else_after";

const ZA = "Africa/Johannesburg";
const IND_CC = /massair\s+ind\b/i;
const MASSAIR_CT = /massair\s+ct\b/i;

export interface JobCardCompany {
  legalName: string;
  vatNo: string;
  tel: string;
  email: string;
  web: string;
  addressLines: string[];
}

export interface JobCardUnitInput {
  brand?: string | null;
  model?: string | null;
  position?: string | null;
  serial?: string | null;
  label?: string | null;
}

export interface JobCardPhotoInput {
  client_visible: boolean;
  photo_type?: string | null;
  caption?: string | null;
}

export interface JobCardMaterialInput {
  name?: string | null;
  item?: string | null;
  qty?: number | null;
  unit?: string | null;
}

export interface JobCardTimeInput {
  start?: string | null;
  end?: string | null;
  minutes?: number | null;
}

export interface JobCardDraft {
  company: JobCardCompany;
  clientName?: string | null;
  clientVat?: string | null;
  siteAddress?: string | null;
  jobTitle?: string | null;
  jobType?: string | null;
  /** ISO timestamps or YYYY-MM-DD work dates. */
  jobDates?: (string | null | undefined)[];
  completedAt: string;
  workDone?: string | null;
  units?: JobCardUnitInput[];
  photos?: { label: string; caption?: string | null; dataUrl?: string | null }[];
  materials?: JobCardMaterialInput[];
  times?: JobCardTimeInput[];
  labourMinutes?: number | null;
  technicianName?: string | null;
  signatureDataUrl?: string | null;
  signerName?: string | null;
}

export interface JobCardModel {
  company: JobCardCompany;
  companyLines: string[];
  clientName: string;
  clientVat: string | null;
  siteAddress: string | null;
  jobTitle: string | null;
  jobTypeLabel: string;
  jobDatesLabel: string;
  completedAt: string;
  completedLabel: string;
  workDone: string;
  units: { title: string; brand: string; model: string; position: string; serial: string }[];
  photos: { label: string; caption: string | null; dataUrl: string | null }[];
  materials: { name: string; qtyLabel: string }[];
  onSite: string[];
  technicianName: string;
  techSignOff: string;
  signed: boolean;
  signatureName: string | null;
  signatureDate: string | null;
  signatureDataUrl: string | null;
  unsignedLabel: string;
  popia: string;
  warrantyLines: string[];
  labourWarranty: string;
}

export function jobCardStoragePath(companyId: string, jobId: string): string {
  return `${companyId}/${jobId}/${JOB_CARD_FILE}`;
}

export function normalisePhotoMode(value: unknown): JobCardPhotoMode {
  return value === "client_visible_only" ? "client_visible_only" : DEFAULT_JOB_CARD_PHOTO_MODE;
}

/** Drop a trailing "t/a …" so the legal name never prints a trading-as line. */
export function stripTradingAs(name: string): string {
  return String(name || "").replace(/\s+t\/a\b[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
}

export function isMassairInd(name: string | null | undefined): boolean {
  return IND_CC.test(String(name || ""));
}

/** Massair CT's own profile. Massair Ind CC is never chosen. */
export function pickJobCardProfile<T extends Partial<CompanyProfile>>(profiles: T[]): T | null {
  const live = profiles.filter((p) => p && !p.archived_at && p.legal_name && !isMassairInd(p.legal_name));
  const ct = live.filter((p) => MASSAIR_CT.test(String(p.legal_name)));
  if (ct.length) return ct.find((p) => p.is_default) || ct[0];
  return live.find((p) => p.is_default) || live[0] || null;
}

function ctFallback(): JobCardCompany {
  return {
    legalName: MASSAIR_CT_LEGAL_NAME,
    vatNo: COMPANY.vatNo,
    tel: COMPANY.tel,
    email: COMPANY.email,
    web: COMPANY.web,
    addressLines: [...COMPANY.addressLines],
  };
}

/** Header lines for the card. Logo is separate. No trading-as line and no Massair Ind CC. */
export function companyForJobCard(profile?: Partial<CompanyProfile> | null, companyId?: string | null): JobCardCompany {
  if (!profile?.legal_name || isMassairInd(profile.legal_name)) {
    if (companyId && companyId !== COMPANY.companyId) {
      return { legalName: "", vatNo: "", tel: "", email: "", web: "", addressLines: [] };
    }
    return ctFallback();
  }
  const id = profileIdentity(profile);
  const legalName = MASSAIR_CT.test(profile.legal_name) ? MASSAIR_CT_LEGAL_NAME : stripTradingAs(id.legalName);
  const clean = (lines: string[]) => lines.map((l) => stripTradingAs(l)).filter((l) => l && !isMassairInd(l) && !/\bt\/a\b/i.test(l));
  return {
    legalName,
    vatNo: id.vatNo,
    tel: id.tel,
    email: id.email,
    web: id.web,
    addressLines: clean(id.addressLines),
  };
}

export function companyHeaderLines(company: JobCardCompany): string[] {
  return [
    company.legalName,
    company.vatNo ? `VAT No ${company.vatNo}` : "",
    company.tel,
    ...company.addressLines,
    [company.email, company.web].filter(Boolean).join(" | "),
  ].map((s) => String(s || "").trim()).filter(Boolean);
}

export function selectJobCardPhotos<T extends JobCardPhotoInput>(photos: T[], mode: JobCardPhotoMode = DEFAULT_JOB_CARD_PHOTO_MODE): T[] {
  const flagged = photos.filter((p) => p.client_visible);
  if (flagged.length || mode === "client_visible_only") return flagged;
  return photos.filter((p) => String(p.photo_type || "").toLowerCase() === "after");
}

export function photoKindLabel(photoType: string | null | undefined): string {
  const t = String(photoType || "").toLowerCase();
  if (t === "before") return "Before";
  if (t === "after") return "After";
  if (t === "site") return "Site";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Photo";
}

export function unitPositionLabel(position: string | null | undefined): string {
  const p = String(position || "").toLowerCase();
  if (p.startsWith("in")) return "Indoor";
  if (p.startsWith("out")) return "Outdoor";
  return String(position || "").trim() || "Unit";
}

export function johannesburgYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function formatJobCardDate(ymdOrIso: string | null | undefined): string {
  const ymd = johannesburgYmd(ymdOrIso);
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function formatJobCardTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZA }).format(d);
}

export function addCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)).toISOString().slice(0, 10);
}

export function labourWarrantySentence(completedAt: string): string {
  const from = johannesburgYmd(completedAt) || johannesburgYmd(new Date().toISOString());
  const until = addCalendarMonths(from, LABOUR_WARRANTY_MONTHS);
  return `Labour and workmanship are warranted for ${LABOUR_WARRANTY_MONTHS} months, from ${formatJobCardDate(from)} to ${formatJobCardDate(until)}.`;
}

/** Names and quantities only. Price, cost and sell fields are ignored. */
export function materialLines(rows: JobCardMaterialInput[]): { name: string; qty: number; unit: string | null }[] {
  const map = new Map<string, { name: string; qty: number; unit: string | null }>();
  for (const row of rows) {
    const name = String(row.name || row.item || "").replace(/\s+/g, " ").trim();
    const qty = Number(row.qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    const key = name.toLowerCase();
    const prev = map.get(key);
    if (prev) prev.qty = Math.round((prev.qty + qty) * 100) / 100;
    else map.set(key, { name, qty, unit: row.unit ? String(row.unit).trim() : null });
  }
  return [...map.values()];
}

export function formatQty(qty: number, unit?: string | null): string {
  const n = Number(qty);
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return unit ? `${text} ${unit}` : text;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h && rem) return `${h} h ${rem} min`;
  if (h) return `${h} h`;
  return `${rem} min`;
}

export function onSiteLines(times: JobCardTimeInput[], labourMinutes?: number | null): string[] {
  const lines: string[] = [];
  for (const t of times) {
    const day = t.start ? formatJobCardDate(t.start) : "";
    const a = formatJobCardTime(t.start);
    const b = formatJobCardTime(t.end);
    const span = a && b ? `${a}-${b}` : a || b;
    const mins = t.minutes && t.minutes > 0 ? ` (${formatDuration(t.minutes)})` : "";
    const text = [day, span].filter(Boolean).join(" ");
    if (text) lines.push(`${text}${mins}`);
  }
  if (!lines.length && labourMinutes && labourMinutes > 0) lines.push(formatDuration(labourMinutes));
  if (!lines.length) lines.push("Not recorded");
  return lines;
}

export function buildJobCard(draft: JobCardDraft): JobCardModel {
  const company = draft.company;
  const completedAt = draft.completedAt;
  const dates = [...new Set((draft.jobDates || []).map((d) => johannesburgYmd(d)).filter(Boolean))].sort();
  if (!dates.length) {
    const done = johannesburgYmd(completedAt);
    if (done) dates.push(done);
  }
  const signed = Boolean(draft.signatureDataUrl);
  const tech = String(draft.technicianName || "").trim() || "Technician";
  const units = (draft.units || []).map((u) => {
    const position = unitPositionLabel(u.position);
    const brand = String(u.brand || "").trim() || "—";
    const model = String(u.model || "").trim() || "—";
    const serial = String(u.serial || "").trim() || "Not recorded";
    const where = String(u.label || "").trim();
    return {
      title: where ? `${where} · ${position}` : position,
      brand,
      model,
      position,
      serial,
    };
  });
  const materials = materialLines(draft.materials || []).map((m) => ({ name: m.name, qtyLabel: formatQty(m.qty, m.unit) }));
  const warrantyLines = [...installedUnitWarrantyLines(company.legalName || MASSAIR_CT_LEGAL_NAME), WARRANTY_EXCLUSIONS];
  return {
    company,
    companyLines: companyHeaderLines(company),
    clientName: String(draft.clientName || "").trim() || "Client",
    clientVat: String(draft.clientVat || "").trim() || null,
    siteAddress: String(draft.siteAddress || "").trim() || null,
    jobTitle: String(draft.jobTitle || "").trim() || null,
    jobTypeLabel: jobTypeLabel(draft.jobType) || "Job",
    jobDatesLabel: dates.map(formatJobCardDate).join(", "),
    completedAt,
    completedLabel: formatJobCardDate(completedAt),
    workDone: String(draft.workDone || "").trim() || "Done as quoted",
    units,
    photos: (draft.photos || []).map((p) => ({ label: p.label, caption: p.caption?.trim() || null, dataUrl: p.dataUrl || null })),
    materials,
    onSite: onSiteLines(draft.times || [], draft.labourMinutes),
    technicianName: tech,
    techSignOff: `${tech} (name and tick)`,
    signed,
    signatureName: signed ? (String(draft.signerName || draft.clientName || "").trim() || "Client") : null,
    signatureDate: signed ? formatJobCardDate(completedAt) : null,
    signatureDataUrl: signed ? draft.signatureDataUrl || null : null,
    unsignedLabel: UNSIGNED_CLIENT,
    popia: JOB_CARD_POPIA,
    warrantyLines,
    labourWarranty: labourWarrantySentence(completedAt),
  };
}

export function jobCardPreviewLines(model: JobCardModel): { label: string; value: string }[] {
  return [
    { label: "Company", value: model.company.legalName },
    { label: "Client", value: model.clientVat ? `${model.clientName} (VAT ${model.clientVat})` : model.clientName },
    ...(model.siteAddress ? [{ label: "Site", value: model.siteAddress }] : []),
    { label: "Job", value: [model.jobTypeLabel, model.jobDatesLabel].filter(Boolean).join(" · ") },
    { label: "Work done", value: model.workDone },
    { label: "Units", value: model.units.length ? model.units.map((u) => `${u.title}: ${u.brand} ${u.model}, serial ${u.serial}`).join("; ") : "None recorded" },
    { label: "Photos", value: model.photos.length ? `${model.photos.length} on the card` : "None for the card" },
    { label: "Materials", value: model.materials.length ? model.materials.map((m) => `${m.name} x ${m.qtyLabel}`).join(", ") : "None recorded" },
    { label: "On site", value: model.onSite.join("; ") },
    { label: "Technician", value: model.techSignOff },
  ];
}

/**
 * Photos already saved on a quote, its invoice, the site visit, or the customer's site,
 * shown on the job by reading those paths. Nothing is copied.
 *
 * Access (same rule as public.caller_may_read_linked_job):
 * same company, and either an assigned technician, a salesperson who booked or is
 * assigned to that job, or office staff. Another company is never included.
 */

export const LINKED_PHOTO_BUCKETS = ["quote-photos", "job-photos", "site-surveys", "house-photos"] as const;
export type LinkedBucket = (typeof LINKED_PHOTO_BUCKETS)[number];

export const LINKED_PHOTO_SOURCES = ["quote", "invoice", "site_visit", "site"] as const;
export type LinkedPhotoSource = (typeof LINKED_PHOTO_SOURCES)[number];

const SOURCE_RANK: Record<LinkedPhotoSource, number> = {
  quote: 0,
  invoice: 1,
  site_visit: 2,
  site: 3,
};

export type LinkedPhotoRaw = {
  id: string;
  bucket: LinkedBucket;
  storage_path: string;
  display_path: string;
  caption: string | null;
  source: LinkedPhotoSource;
  ref: string | null;
  lead_id: string | null;
  created_at: string | null;
};

export type LinkedPhoto = {
  id: string;
  bucket: LinkedBucket;
  storagePath: string;
  displayPath: string;
  caption: string | null;
  source: LinkedPhotoSource;
  ref: string | null;
  label: string;
  leadId: string | null;
  createdAt: string | null;
};

export type LinkedPhotoView = LinkedPhoto & { url: string };

export type LinkedPhotoAccess = {
  signedIn: boolean;
  callerCompanyId: string | null;
  jobCompanyId: string | null;
  /** Field technician with no office role. */
  techOnly: boolean;
  /** Salesperson. Checked only when they are not a field-only technician. */
  salesRep: boolean;
  /** Admin, office dispatcher, or platform staff in this company. */
  office: boolean;
  /** Live assignment on this job (not declined, cancelled, or rejected). */
  assignedToJob: boolean;
  /** Booked the job, owns the quote or lead, or is assigned to it. */
  repBookedOrAssigned: boolean;
};

/** Same company only. A technician must be assigned to this job. */
export function mayReadLinkedPhotos(a: LinkedPhotoAccess): boolean {
  if (!a.signedIn || !a.callerCompanyId || !a.jobCompanyId) return false;
  if (a.callerCompanyId !== a.jobCompanyId) return false;
  if (a.techOnly) return a.assignedToJob;
  if (a.salesRep) return a.repBookedOrAssigned;
  return a.office;
}

export function linkedSourceLabel(source: LinkedPhotoSource, ref: string | null | undefined): string {
  const name = (ref || "").trim();
  if (source === "quote") return name ? `From quote ${name}` : "From quote";
  if (source === "invoice") return name ? `From invoice ${name}` : "From invoice";
  if (source === "site") return "From the customer's site";
  return "From site visit";
}

/** Storage path we are willing to sign. Rejects traversal and full URLs. */
export function linkedPhotoPathOk(path: string | null | undefined): path is string {
  if (!path) return false;
  const p = path.trim();
  if (!p || p.includes("..") || p.startsWith("/") || p.includes("://") || /[\n\r]/.test(p)) return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

export function parseLinkedPhotoRows(data: unknown): LinkedPhotoRaw[] {
  let value = data;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const out: LinkedPhotoRaw[] = [];
  for (const row of value) {
    const r = asRecord(row);
    if (!r) continue;
    const bucket = asText(r.bucket);
    const source = asText(r.source);
    const storage = asText(r.storage_path);
    const display = asText(r.display_path) || storage;
    const id = asText(r.id);
    if (!id || !bucket || !source || !storage || !display) continue;
    if (!(LINKED_PHOTO_BUCKETS as readonly string[]).includes(bucket)) continue;
    if (!(LINKED_PHOTO_SOURCES as readonly string[]).includes(source)) continue;
    if (!linkedPhotoPathOk(storage) || !linkedPhotoPathOk(display)) continue;
    out.push({
      id,
      bucket: bucket as LinkedBucket,
      storage_path: storage,
      display_path: display,
      caption: asText(r.caption),
      source: source as LinkedPhotoSource,
      ref: asText(r.ref),
      lead_id: asText(r.lead_id),
      created_at: asText(r.created_at),
    });
  }
  return out;
}

function prefer(a: LinkedPhoto, b: LinkedPhoto): LinkedPhoto {
  const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (bySource !== 0) return bySource < 0 ? a : b;
  if (!!a.ref !== !!b.ref) return a.ref ? a : b;
  const at = a.createdAt || "";
  const bt = b.createdAt || "";
  if (at !== bt) return at < bt ? a : b;
  return a.id <= b.id ? a : b;
}

/** One row per bucket + original path. Quote label wins over the invoice that points at the same file. */
export function unionLinkedPhotos(rows: LinkedPhotoRaw[]): LinkedPhoto[] {
  const byKey = new Map<string, LinkedPhoto>();
  for (const row of rows) {
    const photo: LinkedPhoto = {
      id: row.id,
      bucket: row.bucket,
      storagePath: row.storage_path,
      displayPath: row.display_path,
      caption: row.caption,
      source: row.source,
      ref: row.ref,
      label: linkedSourceLabel(row.source, row.ref),
      leadId: row.lead_id,
      createdAt: row.created_at,
    };
    const key = `${photo.bucket}\n${photo.storagePath}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, photo);
      continue;
    }
    const winner = prefer(prev, photo);
    const other = winner === prev ? photo : prev;
    if (winner.displayPath === winner.storagePath && other.displayPath !== other.storagePath) {
      winner.displayPath = other.displayPath;
    }
    if (!winner.caption && other.caption) winner.caption = other.caption;
    byKey.set(key, winner);
  }
  return [...byKey.values()].sort((a, b) => {
    const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (bySource !== 0) return bySource;
    const byLabel = a.label.localeCompare(b.label);
    if (byLabel !== 0) return byLabel;
    const at = a.createdAt || "";
    const bt = b.createdAt || "";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Photos already on this job's own lead stay in the job photo card.
 * Quote, invoice, other-lead, survey, and house photos stay in the linked strip.
 */
export function visibleLinkedPhotos(photos: LinkedPhoto[], jobLeadId: string | null | undefined): LinkedPhoto[] {
  if (!jobLeadId) return photos;
  return photos.filter((p) => !(p.bucket === "job-photos" && p.leadId === jobLeadId));
}

export function groupLinkedPhotos<T extends { label: string }>(photos: T[]): { label: string; photos: T[] }[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const p of photos) {
    const list = map.get(p.label);
    if (list) list.push(p);
    else {
      order.push(p.label);
      map.set(p.label, [p]);
    }
  }
  return order.map((label) => ({ label, photos: map.get(label)! }));
}

/** Missing function, or a job this person cannot open. The page stays quiet. */
export function linkedPhotosQuietError(message: string | null | undefined): boolean {
  const m = message || "";
  return /job_linked_photos|does not exist|42883|PGRST202|schema cache|Job not found|42501/i.test(m);
}

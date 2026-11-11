import { defaultMinutes } from "@/lib/schedulingDefaults";
import { johannesburgToday, type Doing, type VisitKind, type WhereMode } from "@/lib/bookJobPath";
import type { JobKind } from "@/lib/jobTypeChoice";

/** Bump when the stored shape changes. Older payloads are ignored, never applied. */
export const BOOK_JOB_DRAFT_VERSION = 1;
export const BOOK_JOB_DRAFT_PREFIX = `fl.book-job.v${BOOK_JOB_DRAFT_VERSION}:`;

export type BookJobPast = {
  techId: string;
  date: string;
  arrive: string;
  leave: string;
  note: string;
  completed: boolean;
};

export type BookJobDraftBody = {
  title: string;
  description: string;
  customerId: string;
  leadId: string;
  quoteId: string;
  locationId: string;
  address: string;
  appt: { date: string; startTime: string; durationMinutes: number; agentId: string };
  priority: string;
  jobKind: JobKind | null;
  durationTouched: boolean;
  lat: number | null;
  lng: number | null;
  geoStatus: "idle" | "ok" | "failed" | "inherited" | "pinned";
  showPicker: boolean;
  where: WhereMode;
  doing: Doing;
  projectId: string;
  houseId: string;
  visitKinds: VisitKind[];
  customLabel: string;
  titleTouched: boolean;
  addressTouched: boolean;
  past: BookJobPast;
  correctId: string | null;
};

export type BookJobDraftRecord = {
  version: typeof BOOK_JOB_DRAFT_VERSION;
  userId: string;
  companyId: string;
  context: string;
  open: boolean;
  body: BookJobDraftBody;
};

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function bookJobDraftKey(userId: string, companyId: string, context: string): string {
  return `${BOOK_JOB_DRAFT_PREFIX}${userId}:${companyId}:${context}`;
}

/** sessionStorage when it can be written. Private mode and blocked storage return null. */
export function bookJobStorage(): DraftStorage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const probe = `${BOOK_JOB_DRAFT_PREFIX}probe`;
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return sessionStorage;
  } catch {
    return null;
  }
}

export function freshBookJobBody(defaults?: {
  customerId?: string | null;
  leadId?: string | null;
  quoteId?: string | null;
}): BookJobDraftBody {
  return {
    title: "",
    description: "",
    customerId: defaults?.customerId || "",
    leadId: defaults?.leadId || "",
    quoteId: defaults?.quoteId || "",
    locationId: "",
    address: "",
    appt: { date: "", startTime: "", durationMinutes: defaultMinutes("service"), agentId: "" },
    priority: "normal",
    jobKind: null,
    durationTouched: false,
    lat: null,
    lng: null,
    geoStatus: "idle",
    showPicker: true,
    where: "single",
    doing: "upcoming",
    projectId: "",
    houseId: "",
    visitKinds: [],
    customLabel: "",
    titleTouched: false,
    addressTouched: false,
    past: { techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: false },
    correctId: null,
  };
}

/** A generic Book a job has no lead. A lead-specific open only restores that same lead. */
export function draftMatchesEntry(
  body: BookJobDraftBody,
  defaults?: { customerId?: string | null; leadId?: string | null; quoteId?: string | null },
): boolean {
  const lead = defaults?.leadId || "";
  const customer = defaults?.customerId || "";
  const quote = defaults?.quoteId || "";
  if (!lead && !customer && !quote) return true;
  return body.leadId === lead && body.customerId === (customer || body.customerId) && (!quote || body.quoteId === quote);
}

function isRecord(value: unknown, userId: string, companyId: string, context: string): value is BookJobDraftRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as BookJobDraftRecord;
  const body = row.body;
  return row.version === BOOK_JOB_DRAFT_VERSION
    && row.userId === userId
    && row.companyId === companyId
    && row.context === context
    && !!body
    && typeof body.title === "string"
    && typeof body.past?.techId === "string"
    && typeof body.past?.date === "string"
    && Array.isArray(body.visitKinds)
    && (body.doing === "upcoming" || body.doing === "past" || body.doing === "correct")
    && (body.where === "single" || body.where === "project");
}

export function readBookJobDraft(
  storage: DraftStorage | null,
  userId: string | null | undefined,
  companyId: string | null | undefined,
  context: string,
): BookJobDraftRecord | null {
  if (!storage || !userId || !companyId || !context) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(bookJobDraftKey(userId, companyId, context));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed, userId, companyId, context)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBookJobDraft(storage: DraftStorage | null, record: BookJobDraftRecord): boolean {
  if (!storage) return false;
  if (!isRecord(record, record.userId, record.companyId, record.context)) return false;
  try {
    storage.setItem(bookJobDraftKey(record.userId, record.companyId, record.context), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearBookJobDraft(
  storage: DraftStorage | null,
  userId: string | null | undefined,
  companyId: string | null | undefined,
  context: string,
): void {
  if (!storage || !userId || !companyId || !context) return;
  try {
    storage.removeItem(bookJobDraftKey(userId, companyId, context));
  } catch {
    /* storage already unavailable */
  }
}

function draftKeys(storage: DraftStorage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(BOOK_JOB_DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

/** Sign-out drops every Book a job draft in this tab. */
export function clearAllBookJobDrafts(storage: DraftStorage | null = bookJobStorage()): void {
  if (!storage) return;
  for (const key of draftKeys(storage)) {
    try { storage.removeItem(key); } catch { /* ignore */ }
  }
}

/** Account switch keeps the signed-in user's drafts and drops everyone else's. */
export function clearOtherUsersBookJobDrafts(userId: string, storage: DraftStorage | null = bookJobStorage()): void {
  if (!storage || !userId) return;
  const keep = `${BOOK_JOB_DRAFT_PREFIX}${userId}:`;
  for (const key of draftKeys(storage)) {
    if (key.startsWith(keep)) continue;
    try { storage.removeItem(key); } catch { /* ignore */ }
  }
}

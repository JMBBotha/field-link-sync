// Book a job front door (Johan, 8 Nov 2026 — preview only).
// One house = the project tile + one installation job + its visits.
// First fix is a visit on that installation job, not a new sale and not a call-out.
// Past saves stay on the admin backfill path: no client message, no rep alert.
import { directJobsByHouse } from "@/lib/projectTracker";

export type WhereMode = "single" | "project";
export type Doing = "upcoming" | "past" | "correct";
export type VisitKind = "first_fix" | "piping" | "ac_installation" | "commission" | "warranty" | "repair" | "service" | "custom";

export const DOING_CHOICES: { id: Doing; title: string; hint: string }[] = [
  { id: "upcoming", title: "Book upcoming work", hint: "Today's path. Schedule the visit." },
  { id: "past", title: "Log work that already happened", hint: "Today or earlier. The client is not messaged and reps are not alerted." },
  { id: "correct", title: "Correct a visit later", hint: "Find the visit and edit the same record." },
];

export const VISIT_KINDS: { id: VisitKind; title: string }[] = [
  { id: "first_fix", title: "First fix" },
  { id: "piping", title: "Piping" },
  { id: "ac_installation", title: "AC installation" },
  { id: "commission", title: "Commission" },
  { id: "warranty", title: "Warranty visit" },
  { id: "repair", title: "Repair" },
  { id: "service", title: "Service" },
  { id: "custom", title: "Custom" },
];

const KIND_ORDER = VISIT_KINDS.map((k) => k.id);
const KIND_TITLE: Record<VisitKind, string> = Object.fromEntries(VISIT_KINDS.map((k) => [k.id, k.title])) as Record<VisitKind, string>;
const LEGACY_KIND: Record<string, VisitKind> = {
  first_fix: "first_fix", later_install: "ac_installation", house_service: "service",
  piping: "piping", ac_installation: "ac_installation", commission: "commission", warranty: "warranty", repair: "repair", service: "service", custom: "custom",
};

/** One visit can be several kinds. Order follows the dropdown. */
export function normaliseKinds(kinds: Iterable<VisitKind | string | null | undefined>): VisitKind[] {
  const picked = new Set<VisitKind>();
  for (const raw of kinds) {
    const k = LEGACY_KIND[String(raw || "").trim()];
    if (k) picked.add(k);
  }
  return KIND_ORDER.filter((k) => picked.has(k));
}

export function toggleKind(current: VisitKind[], id: VisitKind): VisitKind[] {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return normaliseKinds(next);
}

export function includesFirstFix(kinds: Iterable<VisitKind> | null | undefined): boolean {
  return !!kinds && [...kinds].includes("first_fix");
}

export function kindsLabel(kinds: VisitKind[], customLabel?: string | null): string {
  const named = customLabel?.trim();
  return normaliseKinds(kinds).map((k) => (k === "custom" ? (named || "Custom") : KIND_TITLE[k])).join(" + ");
}

/** Custom is ticked but he has not named it yet. That save is not complete. */
export function customLabelMissing(kinds: VisitKind[], customLabel?: string | null): boolean {
  return kinds.includes("custom") && !customLabel?.trim();
}

export interface HouseJobRef {
  id: string;
  title: string | null;
  description?: string | null;
  customer_id: string | null;
  job_type: string | null;
  quote_id?: string | null;
  lead_id: string | null;
}

export interface VisitRecord {
  id: string;
  jobId: string;
  techId: string;
  techName: string;
  date: string;
  arrive: string;
  leave: string;
  note: string;
  completed: boolean;
  kinds: VisitKind[];
  customLabel?: string | null;
}

/** Admin / owner gate already used by Add past visit. Sales logins are not admins. */
export const canLogPastWork = (isAdmin: boolean) => isAdmin;

export function johannesburgToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Today or earlier. A future date is not a past visit. */
export function pastDateAllowed(date: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
}

/** Upcoming work with no installation job yet keeps the two cards. An existing install, or logging past work, is a visit. */
export function workCards(doing: Doing, hasInstallationJob: boolean): "new_sale" | "visit" {
  if (doing === "past" || doing === "correct") return "visit";
  if (hasInstallationJob) return "visit";
  return "new_sale";
}

/** The house's installation job, else a quote already opened for that house. Never a service call-out. */
export function installationJobForHouse<J extends HouseJobRef>(
  house: { id: string; house_no: string },
  jobs: J[],
  customerId: string,
): J | null {
  const named = directJobsByHouse([house], jobs, customerId)[house.id] || [];
  const kind = (j: J) => (j.job_type || "").toLowerCase();
  return named.find((j) => kind(j) === "installation") || named.find((j) => kind(j) === "quote") || null;
}

export function houseAttachPlan<J extends HouseJobRef>(house: { id: string; house_no: string }, jobs: J[], customerId: string) {
  const job = installationJobForHouse(house, jobs, customerId);
  return {
    job,
    attached: !!job,
    createInstallationJob: !job,
    createSecondJob: false,
    newSale: false,
    callOut: false,
  };
}

export function titleDefault(projectName: string, houseNo: string, kinds: VisitKind[], customLabel?: string | null): string {
  const what = kinds.length ? kindsLabel(kinds, customLabel) : "Installation";
  return `${what} — ${projectName} House ${houseNo}`;
}

/** Whole job finished stays off unless someone turns it on. A first fix usually is not the whole install. */
export const defaultCompleted = (_kinds: VisitKind[] = []) => false;

/** Stored set on the visit. A comma string or one old value still reads as a set. A note that says First fix counts. */
export function kindsFromStored(stored?: unknown, note?: string | null): VisitKind[] {
  const raw = Array.isArray(stored) ? stored : typeof stored === "string" ? stored.split(",") : [];
  const kinds = normaliseKinds(raw as string[]);
  if (!kinds.length && /first\s*fix/i.test(note || "")) return ["first_fix"];
  return kinds;
}

export interface LogPlan {
  ok: boolean;
  reason?: "admin_only" | "date" | "visit" | "kind" | "custom";
  createInstallationJob: boolean;
  jobType: "installation";
  quoteId: null;
  callOut: false;
  newSale: false;
  path: "visit_on_installation";
  writes: 0 | 1;
  messageClient: false;
  alertReps: false;
  completed: boolean;
  rpc: "admin_backfill_visit" | "admin_correct_visit";
  sameVisitId: string | null;
  markFirstFit: boolean;
}

export function planPastSave(input: {
  doing: "past" | "correct";
  visitKinds: VisitKind[];
  customLabel?: string | null;
  existingJobId: string | null;
  completed: boolean;
  date: string;
  today: string;
  role: { isAdmin: boolean };
  visitId?: string | null;
}): LogPlan {
  const plan: LogPlan = {
    ok: false,
    createInstallationJob: input.doing === "past" && !input.existingJobId,
    jobType: "installation",
    quoteId: null,
    callOut: false,
    newSale: false,
    path: "visit_on_installation",
    writes: 0,
    messageClient: false,
    alertReps: false,
    completed: input.completed,
    rpc: input.doing === "correct" ? "admin_correct_visit" : "admin_backfill_visit",
    sameVisitId: input.doing === "correct" ? (input.visitId ?? null) : null,
    markFirstFit: includesFirstFix(input.visitKinds),
  };
  if (!input.role.isAdmin) return { ...plan, reason: "admin_only" };
  if (!input.visitKinds.length) return { ...plan, reason: "kind" };
  if (customLabelMissing(input.visitKinds, input.customLabel)) return { ...plan, reason: "custom" };
  if (!pastDateAllowed(input.date, input.today)) return { ...plan, reason: "date" };
  if (input.doing === "correct" && !input.visitId) return { ...plan, reason: "visit" };
  return { ...plan, ok: true, writes: 1 };
}

/** Row for a house that has no installation job yet. Not a quote and not a call-out. */
export function installationJobInsert(input: {
  companyId: string;
  customerId: string;
  title: string;
  description: string | null;
  address: string | null;
  userId: string | null;
}) {
  return {
    company_id: input.companyId,
    customer_id: input.customerId,
    title: input.title,
    description: input.description,
    job_type: "installation" as const,
    quote_id: null,
    lead_id: null,
    call_out_excl_vat: null,
    address: input.address,
    priority: "normal" as const,
    status: "scheduled" as const,
    created_by: input.userId,
  };
}

/** Edit the same visit. The id does not change and nothing is copied. */
export function applyCorrection(visit: VisitRecord, patch: Partial<Omit<VisitRecord, "id" | "jobId">>): VisitRecord {
  return { ...visit, ...patch, id: visit.id, jobId: visit.jobId };
}

export function firstFitDoneFromVisits(visits: { kinds: VisitKind[] }[]): boolean {
  return visits.some((v) => includesFirstFix(v.kinds));
}

/** The house First fit step follows the visits. Same truth, no second record. First fix among other kinds still counts. */
export function withFirstFit<S extends { step_key: string; done: boolean }>(steps: S[], visits: { kinds: VisitKind[] }[]): S[] {
  const done = firstFitDoneFromVisits(visits);
  if (steps.some((s) => s.step_key === "first_fit")) return steps.map((s) => (s.step_key === "first_fit" ? { ...s, done } : s));
  if (!done) return steps;
  const seed = steps[0];
  return [...steps, (seed ? { ...seed, step_key: "first_fit", done: true } : { step_key: "first_fit", done: true }) as S];
}

export function firstFitInStep(steps: { step_key: string; done: boolean }[], visits: { kinds: VisitKind[] }[]): boolean {
  const done = firstFitDoneFromVisits(visits);
  const step = steps.find((s) => s.step_key === "first_fit");
  return done === !!step?.done;
}

export interface SaveEffects {
  createJob: () => Promise<string>;
  backfill: (jobId: string) => Promise<string>;
  correct: (visitId: string) => Promise<string>;
  syncFirstFit?: (done: boolean) => Promise<void>;
  firstFitDone?: boolean;
  notifyClient?: () => Promise<void>;
  alertReps?: () => Promise<void>;
}

/** One visit write. Never calls the client-message or rep-alert hooks. */
export async function runPastSave(plan: LogPlan, existingJobId: string | null, effects: SaveEffects): Promise<{ jobId: string; entryId: string }> {
  if (!plan.ok || plan.writes !== 1) throw new Error(plan.reason || "no");
  if (plan.messageClient || plan.alertReps || plan.newSale || plan.callOut || plan.quoteId) throw new Error("quiet");
  const jobId = plan.createInstallationJob ? await effects.createJob() : existingJobId;
  if (!jobId) throw new Error("job");
  const entryId = plan.rpc === "admin_correct_visit" ? await effects.correct(plan.sameVisitId || "") : await effects.backfill(jobId);
  if (plan.sameVisitId && entryId !== plan.sameVisitId) throw new Error("same record");
  if (effects.syncFirstFit) await effects.syncFirstFit(!!effects.firstFitDone);
  return { jobId, entryId };
}

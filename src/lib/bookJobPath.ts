// Book a job front door (Johan, 8 Nov 2026 — preview only).
// One house = the project tile + one installation job + its visits.
// First fix is a visit on that installation job, not a new sale and not a call-out.
// Past saves stay on the admin backfill path: no client message, no rep alert.
import { directJobsByHouse } from "@/lib/projectTracker";

export type WhereMode = "single" | "project";
export type Doing = "upcoming" | "past" | "correct";
export type VisitKind = "first_fix" | "later_install" | "house_service";

export const DOING_CHOICES: { id: Doing; title: string; hint: string }[] = [
  { id: "upcoming", title: "Book upcoming work", hint: "Today's path. Schedule the visit." },
  { id: "past", title: "Log work that already happened", hint: "Today or earlier. The client is not messaged and reps are not alerted." },
  { id: "correct", title: "Correct a visit later", hint: "Find the visit and edit the same record." },
];

export const VISIT_KINDS: { id: VisitKind; title: string; hint: string }[] = [
  { id: "first_fix", title: "First fix", hint: "A visit on this house's installation job. Not a new sale and not a call-out." },
  { id: "later_install", title: "A later install visit", hint: "Another visit on the same installation job." },
  { id: "house_service", title: "A service on that house", hint: "Service on this house, still on the installation job." },
];

const KIND_TITLE: Record<VisitKind, string> = {
  first_fix: "First fix",
  later_install: "Install visit",
  house_service: "Service",
};

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
  kind: VisitKind | null;
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

export function titleDefault(projectName: string, houseNo: string, kind: VisitKind | null): string {
  const what = kind ? KIND_TITLE[kind] : "Installation";
  return `${what} — ${projectName} House ${houseNo}`;
}

/** Whole job finished stays off unless someone turns it on. A first fix usually is not the whole install. */
export const defaultCompleted = (_kind: VisitKind | null) => false;

export function kindFromStored(stored?: string | null, note?: string | null): VisitKind | null {
  if (stored === "first_fix" || stored === "later_install" || stored === "house_service") return stored;
  if (/first\s*fix/i.test(note || "")) return "first_fix";
  return null;
}

export interface LogPlan {
  ok: boolean;
  reason?: "admin_only" | "date" | "visit" | "kind";
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
  visitKind: VisitKind | null;
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
    markFirstFit: input.visitKind === "first_fix",
  };
  if (!input.role.isAdmin) return { ...plan, reason: "admin_only" };
  if (!input.visitKind) return { ...plan, reason: "kind" };
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

export function firstFitDoneFromVisits(visits: { kind: VisitKind | null }[]): boolean {
  return visits.some((v) => v.kind === "first_fix");
}

/** The house First fit step follows the visits. Same truth, no second record. */
export function withFirstFit<S extends { step_key: string; done: boolean }>(steps: S[], visits: { kind: VisitKind | null }[]): S[] {
  const done = firstFitDoneFromVisits(visits);
  if (steps.some((s) => s.step_key === "first_fit")) return steps.map((s) => (s.step_key === "first_fit" ? { ...s, done } : s));
  if (!done) return steps;
  const seed = steps[0];
  return [...steps, (seed ? { ...seed, step_key: "first_fit", done: true } : { step_key: "first_fit", done: true }) as S];
}

export function firstFitInStep(steps: { step_key: string; done: boolean }[], visits: { kind: VisitKind | null }[]): boolean {
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

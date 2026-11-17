/**
 * V8 stage, derived from records the app already stores.
 * Install: Lead → Visit → Quote sent → Deposit due → Ready to book → On site → Balance due → Paid.
 * Service call-out: Booked → On site → Pay due → Paid.
 * A call-out is its own line. It is never subtracted from a quote, a deposit, or a balance.
 */
import { CALL_OUT_EXCL_VAT, kindOfJobType } from "@/lib/jobTypeChoice";

export const V8_CALL_OUT_EXCL_VAT = CALL_OUT_EXCL_VAT;

export const V8_INSTALL_STAGES = [
  { key: "lead", label: "Lead" },
  { key: "visit", label: "Visit" },
  { key: "quote_sent", label: "Quote sent" },
  { key: "deposit_due", label: "Deposit due" },
  { key: "ready", label: "Ready to book" },
  { key: "on_site", label: "On site" },
  { key: "balance_due", label: "Balance due" },
  { key: "paid", label: "Paid" },
] as const;

export const V8_SERVICE_STAGES = [
  { key: "booked", label: "Booked" },
  { key: "on_site", label: "On site" },
  { key: "pay_due", label: "Pay due" },
  { key: "paid", label: "Paid" },
] as const;

export type V8InstallKey = (typeof V8_INSTALL_STAGES)[number]["key"];
export type V8ServiceKey = (typeof V8_SERVICE_STAGES)[number]["key"];
export type V8StageKey = V8InstallKey | V8ServiceKey;

export interface V8StageInput {
  kind?: "install" | "service" | null;
  jobType?: string | null;
  title?: string | null;
  quoteStatus?: string | null;
  quoteSentAt?: string | null;
  quoteAccepted?: boolean;
  /** Still owing on the deposit invoice. Null means no deposit invoice yet. */
  depositRemaining?: number | null;
  depositPaid?: boolean;
  techId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  jobStatus?: string | null;
  /** Still owing on the balance invoice. */
  balanceRemaining?: number | null;
  /** Still owing on a service invoice. */
  payRemaining?: number | null;
  paid?: boolean;
  visitBooked?: boolean;
  callOutExclVat?: number | null;
  quoteTotal?: number | null;
}

export interface V8Stage {
  track: "install" | "service";
  key: V8StageKey;
  label: string;
  /** Lost, declined, or cancelled work stays off the active pills. */
  active: boolean;
}

const OWING = 0.005;
const LOST = /declined|rejected|lost|cancelled|canceled/;
const DONE = /complete|completed|done/;
const STARTED = /progress|on_site|onsite|dispatched|en_route|started|arrived/;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function owing(n: number | null | undefined): boolean | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n) > OWING;
}

export function v8Track(job: V8StageInput): "install" | "service" {
  if (job.kind === "service" || job.kind === "install") return job.kind;
  if (kindOfJobType(job.jobType) === "service") return "service";
  const blob = `${job.jobType || ""} ${job.title || ""}`.toLowerCase();
  if (/repair|service|call-out|call out/.test(blob) && !/install/.test(blob)) return "service";
  return "install";
}

function stage(track: "install" | "service", key: V8StageKey, active = true): V8Stage {
  const list = track === "service" ? V8_SERVICE_STAGES : V8_INSTALL_STAGES;
  const found = list.find((s) => s.key === key);
  return { track, key, label: found ? found.label : key, active };
}

/** One stage for a lead, quote, or job. Pure. */
export function v8Stage(job: V8StageInput): V8Stage {
  const track = v8Track(job);
  const status = String(job.quoteStatus || "").toLowerCase();
  const jobStatus = String(job.jobStatus || "").toLowerCase();
  const lost = LOST.test(status) || LOST.test(jobStatus);
  if (track === "service") return serviceStage(job, lost);
  return installStage(job, lost);
}

function installStage(job: V8StageInput, lost: boolean): V8Stage {
  const status = String(job.quoteStatus || "").toLowerCase();
  const jobStatus = String(job.jobStatus || "").toLowerCase();
  const accepted = job.quoteAccepted === true || status === "accepted";
  const sent = accepted || !!job.quoteSentAt || status === "sent" || status === "viewed";
  const done = !!job.completedAt || DONE.test(jobStatus);
  const started = !!job.startedAt || STARTED.test(jobStatus);
  const tech = !!(job.techId && String(job.techId).trim());
  const depositOwing = owing(job.depositRemaining);
  const depositUnpaid = job.depositPaid === false || depositOwing === true;
  const balanceOwing = owing(job.balanceRemaining);

  if (job.paid === true || (done && balanceOwing === false && job.depositPaid === true)) return stage("install", "paid", !lost);
  if (done && job.paid !== true && balanceOwing !== false) return stage("install", "balance_due", !lost);
  if (accepted && depositUnpaid) return stage("install", "deposit_due", !lost);
  if ((tech || started) && !done) return stage("install", "on_site", !lost);
  if (accepted && (job.depositPaid === true || depositOwing === false) && !tech && !started) return stage("install", "ready", !lost);
  if (sent && !accepted) return stage("install", "quote_sent", !lost);
  if (job.visitBooked) return stage("install", "visit", !lost);
  return stage("install", "lead", !lost);
}

function serviceStage(job: V8StageInput, lost: boolean): V8Stage {
  const jobStatus = String(job.jobStatus || "").toLowerCase();
  const done = !!job.completedAt || DONE.test(jobStatus);
  const started = !!job.startedAt || STARTED.test(jobStatus);
  const payOwing = owing(job.payRemaining ?? job.balanceRemaining);
  if (job.paid === true || (done && payOwing === false)) return stage("service", "paid", !lost);
  if (done && job.paid !== true) return stage("service", "pay_due", !lost);
  if (started) return stage("service", "on_site", !lost);
  return stage("service", "booked", !lost);
}

export interface V8MoneyParts {
  quoteTotal: number;
  deposit: number;
  balance: number;
  callOutExclVat: number;
}

/**
 * Call-out stays on its own line. Quote, deposit, and balance come back unchanged.
 */
export function v8MoneyLines(input: { quoteTotal: number; deposit: number; balance: number; callOutExclVat?: number | null }): V8MoneyParts {
  return {
    quoteTotal: round2(input.quoteTotal),
    deposit: round2(input.deposit),
    balance: round2(input.balance),
    callOutExclVat: round2(input.callOutExclVat ?? 0),
  };
}

export function callOutDoesNotReduce(
  before: { quoteTotal: number; deposit: number; balance: number },
  callOutExclVat = V8_CALL_OUT_EXCL_VAT,
): boolean {
  const after = v8MoneyLines({ ...before, callOutExclVat });
  return after.quoteTotal === round2(before.quoteTotal)
    && after.deposit === round2(before.deposit)
    && after.balance === round2(before.balance)
    && after.callOutExclVat === round2(callOutExclVat);
}

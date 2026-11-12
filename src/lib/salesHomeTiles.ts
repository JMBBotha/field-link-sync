/**
 * Sales Home figures. Read-only over data the salesperson already has:
 * get_sales_tracker rows, sales_next_steps rows, their own draft quotes, and today's visits/jobs.
 * A null figure means the source has not loaded — the tile shows a placeholder, never a guessed zero.
 */
import type { TrackerRow } from "@/lib/salesTracker";
import { SALES_HOME_ROUTES } from "@/lib/roleHome";
import { formatRand } from "@/utils/formatRand";

export interface SalesHomeTile {
  key: "commission" | "followups" | "today" | "drafts";
  label: string;
  value: string;
  hint: string;
  href: string;
  /** Commission is the number a salesperson looks at first. */
  lead?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Johannesburg calendar month, YYYY-MM. */
export function johannesburgMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}`;
}

function monthOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00+02:00` : iso);
  return Number.isNaN(d.getTime()) ? null : johannesburgMonth(d);
}

/**
 * Earned this month: commission on earned and paid-out rows whose earn date
 * (snapshot earned_at, else the invoice paid date) is this Johannesburg month.
 * Pending: pipeline commission — accepted, not yet fully paid. Not limited to the month.
 */
export function commissionThisMonth(rows: TrackerRow[], now = new Date()): { earned: number; pending: number } {
  const month = johannesburgMonth(now);
  let earned = 0;
  let pending = 0;
  for (const row of rows) {
    const amount = Number(row.commission);
    const commission = Number.isFinite(amount) ? amount : 0;
    if (row.grp === "pipeline") {
      pending += commission;
      continue;
    }
    if (row.grp !== "earned" && row.grp !== "paid_out") continue;
    const when = monthOf(row.earned_at || row.invoice_paid_date);
    if (when === month) earned += commission;
  }
  return { earned: r2(earned), pending: r2(pending) };
}

/** sales_next_steps rules for a sent quote that still needs a follow-up: due (7+ days, none logged) or cold. */
export function followUpsDue(steps: { rule: string }[]): number {
  return steps.filter((s) => s.rule === "followup" || s.rule === "cold").length;
}

/** Draft quotes the signed-in salesperson owns. The quotes list status=draft shows these rows. */
export function draftsToSend(quotes: { status?: string | null; sales_engineer_id?: string | null }[], userId: string | null): number {
  if (!userId) return 0;
  return quotes.filter((q) => q.sales_engineer_id === userId && String(q.status || "").toLowerCase() === "draft").length;
}

/**
 * Visits booked today, plus this rep's jobs that are in progress or scheduled today and not completed.
 * A job that is the same lead as a visit already counted is not counted twice.
 */
export function jobsBeingDoneToday(
  appointments: { lead_id?: string | null }[],
  jobs: { job_id?: string | null; lead_id?: string | null; scheduled_date?: string | null; stage?: string | null }[],
  today: string,
): number {
  const keys = new Set<string>();
  appointments.forEach((a, i) => keys.add(a.lead_id ? `lead:${a.lead_id}` : `appt:${i}`));
  jobs.forEach((j, i) => {
    const stage = j.stage || "assigned";
    const inProgress = stage === "en_route" || stage === "on_site";
    const scheduledToday = j.scheduled_date === today && stage !== "completed";
    if (!inProgress && !scheduledToday) return;
    if (j.lead_id && keys.has(`lead:${j.lead_id}`)) return;
    keys.add(j.job_id ? `job:${j.job_id}` : j.lead_id ? `lead:${j.lead_id}` : `job:${i}`);
  });
  return keys.size;
}

function shown(n: number | null, money = false): string {
  if (n == null) return "…";
  return money ? formatRand(n) : String(n);
}

export function salesHomeTiles(input: {
  earned: number | null;
  pending: number | null;
  followUps: number | null;
  jobsToday: number | null;
  drafts: number | null;
}): SalesHomeTile[] {
  const pending = input.pending != null && input.pending > 0 ? `${formatRand(input.pending)} pending` : "Earned this month";
  return [
    {
      key: "commission",
      label: "Commission this month",
      value: shown(input.earned, true),
      hint: input.earned == null ? "Earned this month" : pending,
      href: SALES_HOME_ROUTES.commission,
      lead: true,
    },
    {
      key: "followups",
      label: "Quotes to follow up",
      value: shown(input.followUps),
      hint: "Due or overdue",
      href: SALES_HOME_ROUTES.followUps,
    },
    {
      key: "today",
      label: "Jobs today",
      value: shown(input.jobsToday),
      hint: "On today or in progress",
      href: SALES_HOME_ROUTES.schedule,
    },
    {
      key: "drafts",
      label: "Quotes to send",
      value: shown(input.drafts),
      hint: "Drafts not sent",
      href: SALES_HOME_ROUTES.drafts,
    },
  ];
}

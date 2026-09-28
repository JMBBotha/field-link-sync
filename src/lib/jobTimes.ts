/** Job start/complete times — the DB trigger set_job_status_times owns them; the client only sends status. */
export type JobStatusPatch = { status: string };

export function jobStatusPatch(nextStatus: string): JobStatusPatch {
  return { status: nextStatus };
}

const PRE_START = ["scheduled", "dispatched", "pending"];

/** Pure mirror of public.set_job_status_times (UPDATE path), for tests. */
export function applyJobStatusTimes(
  old: { status: string | null; started_at: string | null; completed_at: string | null },
  next: { status: string; started_at?: string | null; completed_at?: string | null },
  now: string,
) {
  let started = next.started_at ?? old.started_at;
  let completed = next.completed_at ?? old.completed_at;
  if (next.status === old.status) return { status: next.status, started_at: started, completed_at: completed };
  if (next.status === "in_progress") started = next.started_at ?? old.started_at ?? now;
  if (next.status === "completed") {
    completed = next.completed_at ?? now;
    started = next.started_at ?? old.started_at ?? now;
  }
  if (old.status === "completed" && next.status !== "completed") completed = null;
  if (PRE_START.includes(next.status)) started = null;
  return { status: next.status, started_at: started, completed_at: completed };
}

/** 'd MMM yyyy, HH:mm' in Africa/Johannesburg. */
export function formatJohannesburg(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")} ${p("month")} ${p("year")}, ${p("hour")}:${p("minute")}`;
}

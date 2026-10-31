/** Status-aware job action bar (Johan 31 Oct). Pure so it can be unit tested. */
export type JobPerms = { admin: boolean; linked_admin?: boolean; rep: boolean; tech: boolean };
export type JobBar = {
  primary: "start" | "complete" | null;
  completedBadge: boolean;
  canMarkCompleted: boolean;
  canReopen: boolean;
};

/** canRunJob: may this login start/complete the job itself (assigned tech, or non-sales office staff). */
export function jobActionBar(status: string | null | undefined, perms: JobPerms | null | undefined, canRunJob: boolean): JobBar {
  const s = status ?? "";
  const p = perms ?? { admin: false, rep: false, tech: false };
  const open = s === "scheduled" || s === "dispatched";
  return {
    primary: open && canRunJob ? "start" : s === "in_progress" && canRunJob ? "complete" : null,
    completedBadge: s === "completed",
    canMarkCompleted: p.admin && (open || s === "in_progress"),
    canReopen: p.admin && s === "completed",
  };
}

/** Johannesburg wall-clock date + time -> ISO instant (SAST is UTC+2 all year). */
export function jhbLocalToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+02:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function completedLabel(iso: string | null | undefined): string {
  if (!iso) return "Completed";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });
  return `Completed ${date}, ${time}`;
}

export type PhotoCounts = { site: number; before: number; after: number };
export function photoSummary(c: PhotoCounts): { total: number; empty: boolean } {
  const total = c.site + c.before + c.after;
  return { total, empty: total === 0 };
}

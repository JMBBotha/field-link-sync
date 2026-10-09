/** Prefill helpers for the tech completion form (Johan 23:11): times come from the booking/actual timestamps. */
export function toLocalInput(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Start = actual start, else the booking (date + time), else null. Finish = now. */
export function prefillTimes(opts: { startedAt?: string | null; scheduledDate?: string | null; scheduledTime?: string | null; now?: Date }) {
  const now = opts.now ?? new Date();
  let start: Date | null = opts.startedAt ? new Date(opts.startedAt) : null;
  if ((!start || isNaN(start.getTime())) && opts.scheduledDate) {
    start = new Date(`${opts.scheduledDate}T${(opts.scheduledTime || "08:00").slice(0, 5)}:00`);
  }
  if (start && (isNaN(start.getTime()) || start > now)) start = null;
  return { start, finish: now };
}

export function durationText(start: Date | null, finish: Date | null): string {
  if (!start || !finish) return "";
  const mins = Math.max(0, Math.round((finish.getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m ? `${m} min` : ""}`.trim() : `${m} min`;
}

export function timeText(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

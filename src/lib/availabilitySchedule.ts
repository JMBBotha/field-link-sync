/**
 * Weekly availability window. This is the GPS / Available status window only.
 * It does not decide whether a person is free for a job: bookings still go
 * through _tech_offer_fit, _person_bookings and booking_clashes.
 *
 * The SQL twins are availability_in_window / availability_next_boundary /
 * apply_my_availability_schedule. Keep the rules the same.
 */

export const MASSAIR_WEEK_TEMPLATE = {
  timezone: "Africa/Johannesburg",
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  days: [1, 2, 3, 4, 5] as number[],
  start: "07:00",
  end: "18:00",
};

export type IdleStatus = "available" | "offline";

export type AvailabilitySchedule = {
  enabled: boolean;
  days: number[];
  /** HH:MM, 24-hour, in `timezone`. */
  start: string;
  end: string;
  timezone: string;
  overrideStatus: IdleStatus | null;
  /** Exclusive. A manual Available / Off holds until this instant, then the window takes over. */
  overrideUntil: Date | null;
};

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function toggleDay(days: number[], iso: number): number[] {
  const next = new Set(days);
  if (next.has(iso)) next.delete(iso);
  else next.add(iso);
  return [...next].sort((a, b) => a - b);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

type Zoned = { year: number; month: number; day: number; date: string; minutes: number; isodow: number };

function zonedParts(at: Date, timeZone: string): Zoned {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (hour === 24 ? 0 : hour) * 60 + Number(parts.minute),
    isodow: WEEKDAY[parts.weekday] ?? 0,
  };
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const z = zonedParts(at, timeZone);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, Math.floor(z.minutes / 60), z.minutes % 60, 0);
  return asUtc - at.getTime();
}

/** Wall-clock time in `timeZone` as a UTC instant. */
export function zonedToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function isodowOfDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function isInsideWindow(schedule: Pick<AvailabilitySchedule, "days" | "start" | "end" | "timezone">, at: Date): boolean {
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const z = zonedParts(at, schedule.timezone);
  return schedule.days.includes(z.isodow) && z.minutes >= start && z.minutes < end;
}

/** Next time the window opens or closes. Null when no day is selected. */
export function nextBoundary(schedule: Pick<AvailabilitySchedule, "days" | "start" | "end" | "timezone">, at: Date): Date | null {
  if (!schedule.days.length) return null;
  const z = zonedParts(at, schedule.timezone);
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);
  if (schedule.days.includes(z.isodow) && z.minutes >= start && z.minutes < end) {
    return zonedToUtc(z.date, schedule.end, schedule.timezone);
  }
  if (schedule.days.includes(z.isodow) && z.minutes < start) {
    return zonedToUtc(z.date, schedule.start, schedule.timezone);
  }
  for (let i = 1; i <= 7; i++) {
    const date = addDays(z.date, i);
    if (schedule.days.includes(isodowOfDate(date))) {
      return zonedToUtc(date, schedule.start, schedule.timezone);
    }
  }
  return null;
}

/**
 * Status the schedule wants while the person is not Busy on a job.
 * Null means the schedule is off: leave their current status alone.
 */
export function desiredIdleStatus(schedule: AvailabilitySchedule, at: Date): IdleStatus | null {
  if (!schedule.enabled) return null;
  const overrideHolds = schedule.overrideStatus != null
    && (schedule.overrideUntil == null || schedule.overrideUntil.getTime() > at.getTime());
  if (overrideHolds && schedule.overrideStatus) return schedule.overrideStatus;
  return isInsideWindow(schedule, at) ? "available" : "offline";
}

export type ShareSnapshot = {
  signedIn: boolean;
  trackingEnabled: boolean;
  /** profiles.availability_status */
  status: string;
  schedule: AvailabilitySchedule | null;
};

/**
 * Background GPS and agent_locations upserts both require this.
 * Installed-but-off, Not available, Busy, and outside the saved hours are all false.
 */
export function mayShareLocation(snapshot: ShareSnapshot, at: Date = new Date()): boolean {
  if (!snapshot.signedIn || !snapshot.trackingEnabled) return false;
  if (snapshot.status !== "available") return false;
  if (!snapshot.schedule || !snapshot.schedule.enabled) return true;
  return desiredIdleStatus(snapshot.schedule, at) === "available";
}

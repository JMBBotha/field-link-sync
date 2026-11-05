/**
 * Jobs calendar chips (Today / Week / Month): what a booking says at a glance,
 * what the hover/focus card lists, and which existing record a click opens.
 * Display only. Unknowns are left out. No schedule writes.
 */
import { cardHref } from "@/lib/assignedLabel";
import { jobToCard, visitToCard } from "@/lib/cardModel";
import { activeAssignee } from "@/lib/dispatchCards";
import { blockKind, jhbMinutes, type BlockKind } from "@/lib/jobsCalm";
import { dayBadge, dayLabel } from "@/lib/jobDays";
import { jobTypeLabel } from "@/lib/jobTypes";
import type { Person } from "@/lib/jobsBoard";
import { intervalToMinutes } from "@/lib/schedulingDefaults";
import { todayInJohannesburg, type CalendarEntry } from "@/lib/todaysJobs";

export type CalmBlock = {
  id: string;
  /** Stable React key. One job can occupy several days of a multi-day run. */
  uid: string;
  kind: "job" | "visit";
  personId: string | null;
  day: string;
  start: number | null;
  dur: number;
  title: string;
  sub?: string | null;
  place?: string | null;
  block: BlockKind;
  pill?: string | null;
  late?: boolean;
  draggable?: boolean;
  client?: string | null;
  jobType?: string | null;
  serviceType?: string | null;
  assignee?: string | null;
  assigneeRole?: "sales" | "service" | null;
  status?: string | null;
  /** Same-day end, minutes after midnight. Absent when the length is not stored. */
  end?: number | null;
  dayIndex?: number | null;
  dayCount?: number | null;
  /** Existing job or booking page. Null when this row has neither id. */
  href?: string | null;
};

const GENERIC = new Set([
  "installation", "install", "new installation", "service", "repair", "maintenance",
  "technical", "technical service call", "service call", "quote", "new quote",
  "sales", "sales visit", "job", "booking", "booked lead", "appointment",
]);

const STATUS: Record<string, string> = {
  completed: "Done", in_progress: "On site", dispatched: "En route", scheduled: "Scheduled",
  pending: "Booked", assigned: "Assigned", unassigned: "Unassigned", proposed: "Proposed",
};

const PILL: Record<string, string> = { completed: "Done", in_progress: "On site", dispatched: "En route", scheduled: "Scheduled" };

export type GlanceInput = {
  client?: string | null;
  title?: string | null;
  jobType?: string | null;
  serviceType?: string | null;
  place?: string | null;
  assignee?: string | null;
  assigneeRole?: "sales" | "service" | null;
  status?: string | null;
  day: string;
  start: number | null;
  end?: number | null;
  dayIndex?: number | null;
  dayCount?: number | null;
  late?: boolean;
};

export type ChipDensity = "month" | "compact" | "timeline";
export type PopupLine = { label: string; value: string };

const tidy = (s?: string | null) => (s || "").replace(/\s+/g, " ").trim();
const genericName = (s: string) => GENERIC.has(s.toLowerCase());

export function formatMinutes(m: number): string {
  const c = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
}

export function shortType(jobType?: string | null, serviceType?: string | null): string | null {
  const raw = `${jobType || ""} ${serviceType || ""}`.toLowerCase();
  if (!raw.trim()) return null;
  if (/mainten/.test(raw)) return "Maint.";
  if (/install/.test(raw)) return "Install";
  if (/repair|service|call-out|call out|fault/.test(raw)) return "Service";
  if (/sale|quote|consult/.test(raw)) return "Sales";
  const label = tidy(serviceType) || (jobType ? jobTypeLabel(jobType) : "");
  if (!label || genericName(label)) return null;
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
}

/** Client first. Otherwise the part of the title that is not a generic type word. */
export function bookingIdentity(client?: string | null, title?: string | null, jobType?: string | null, serviceType?: string | null): string {
  const c = tidy(client);
  if (c && !genericName(c)) return c;
  const fromTitle = distinctiveTitle(title, jobType);
  if (fromTitle) return fromTitle;
  return shortType(jobType, serviceType) || "Booking";
}

function distinctiveTitle(title?: string | null, jobType?: string | null): string {
  const raw = tidy(title);
  if (!raw) return "";
  const typeLabels = new Set(
    [jobType, jobType ? jobTypeLabel(jobType) : "", "installation", "new installation", "install", "service", "repair", "maintenance", "sales", "sales visit", "quote", "new quote", "technical service call"]
      .map((s) => tidy(s).toLowerCase()).filter(Boolean),
  );
  const parts = raw.split(/\s*[·|—–]\s*|\s+-\s+/).map(tidy).filter(Boolean);
  const kept = (parts.length > 1 ? parts : [raw]).filter((p) => !genericName(p) && !typeLabels.has(p.toLowerCase()));
  const joined = kept.join(" · ");
  if (joined && !genericName(joined)) return joined;
  if (!genericName(raw) && !typeLabels.has(raw.toLowerCase())) return raw;
  return "";
}

export function statusText(status?: string | null, late?: boolean): string | null {
  const s = tidy(status).toLowerCase();
  const label = s ? (STATUS[s] || s.replace(/_/g, " ")) : null;
  if (late && label) return `Late · ${label}`;
  if (late) return "Late";
  return label;
}

export function whenText(b: Pick<GlanceInput, "day" | "start" | "end" | "dayIndex" | "dayCount">): string | null {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? dayLabel(b.day) : null;
  const span = b.start == null ? null
    : b.end != null && b.end > b.start ? `${formatMinutes(b.start)}–${formatMinutes(b.end)}`
    : formatMinutes(b.start);
  const head = date && span ? `${date}, ${span}` : (date || span);
  return [head, dayBadge(b.dayIndex, b.dayCount)].filter(Boolean).join(" · ") || null;
}

function fullType(b: Pick<GlanceInput, "jobType" | "serviceType">): string | null {
  if (b.jobType) {
    const label = jobTypeLabel(b.jobType);
    if (label) return label;
  }
  return tidy(b.serviceType) || null;
}

function referenceText(b: Pick<GlanceInput, "title" | "jobType" | "client">, heading: string): string | null {
  const ref = distinctiveTitle(b.title, b.jobType);
  if (!ref) return null;
  const client = tidy(b.client).toLowerCase();
  if (ref.toLowerCase() === heading.toLowerCase()) return null;
  if (client && ref.toLowerCase() === client) return null;
  return ref;
}

function areaText(place?: string | null, identity?: string): string | null {
  const area = tidy(place).split(",")[0]?.trim() || "";
  if (!area || genericName(area)) return null;
  if (identity && area.toLowerCase() === identity.toLowerCase()) return null;
  return area;
}

export function bookingPopup(b: GlanceInput): { heading: string; lines: PopupLine[] } {
  const heading = bookingIdentity(b.client, b.title, b.jobType, b.serviceType);
  const lines: PopupLine[] = [];
  const client = tidy(b.client);
  if (client && !genericName(client) && client.toLowerCase() !== heading.toLowerCase()) lines.push({ label: "Client", value: client });
  const typeValue = [fullType(b), referenceText(b, heading)].filter(Boolean).join(" · ");
  if (typeValue) lines.push({ label: "Type", value: typeValue });
  const when = whenText(b);
  if (when) lines.push({ label: "When", value: when });
  const who = tidy(b.assignee);
  if (who) lines.push({ label: b.assigneeRole === "sales" ? "Rep" : "Technician", value: who });
  const loc = tidy(b.place);
  if (loc) lines.push({ label: "Location", value: loc });
  const st = statusText(b.status, b.late);
  if (st) lines.push({ label: "Status", value: st });
  return { heading, lines };
}

export function bookingAriaLabel(b: GlanceInput): string {
  const p = bookingPopup(b);
  return [...[p.heading], ...p.lines.map((l) => `${l.label} ${l.value}`)].join(", ") + ". Opens this booking";
}

/** Touch taps open the record. A hover card is for mouse and pen only, so the first tap is not swallowed. */
export function bookingHoverEnabled(pointerType?: string | null): boolean {
  return pointerType !== "touch";
}

/** Time stays whole. Identity is the client (or the distinctive job name). Extras only when they fit. */
export function bookingChip(b: GlanceInput, density: ChipDensity): { time: string | null; identity: string; extra: string | null } {
  const identity = bookingIdentity(b.client, b.title, b.jobType, b.serviceType);
  const time = b.start != null ? formatMinutes(b.start) : null;
  const type = shortType(b.jobType, b.serviceType);
  const typeBit = type && type.toLowerCase() !== identity.toLowerCase() ? type : null;
  const day = dayBadge(b.dayIndex, b.dayCount);
  const dayShort = b.dayCount && b.dayCount > 1 && b.dayIndex ? `${b.dayIndex}/${b.dayCount}` : null;
  const area = areaText(b.place, identity);
  const place = tidy(b.place);
  const placeBit = place && place.toLowerCase() !== identity.toLowerCase() ? place : null;
  let extra: string | null = null;
  if (density === "month") {
    // Colour already shows the type. Keep the client; a short day count is the only extra.
    extra = dayShort;
  } else if (density === "timeline") {
    extra = [typeBit, placeBit, day].filter(Boolean).join(" · ") || null;
  } else {
    extra = [typeBit, area, day].filter(Boolean).join(" · ") || null;
  }
  return { time, identity, extra };
}

export function bookingRecordHref(jobId?: string | null, leadId?: string | null): string | null {
  if (jobId) return cardHref({ job_id: jobId, lead_id: leadId });
  if (leadId) return cardHref({ lead_id: leadId });
  return null;
}

/** Keep the card inside the viewport. Prefer below the chip; flip above when the bottom edge would clip it. */
export function clampPopup(
  anchor: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
  card: { width: number; height: number },
  margin = 8,
): { top: number; left: number } {
  const spaceBelow = viewport.height - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  const top = spaceBelow >= card.height || spaceBelow >= spaceAbove
    ? anchor.bottom + 6
    : anchor.top - card.height - 6;
  let left = anchor.left;
  if (left + card.width > viewport.width - margin) left = viewport.width - card.width - margin;
  if (left < margin) left = margin;
  const maxTop = Math.max(margin, viewport.height - card.height - margin);
  return { top: Math.max(margin, Math.min(top, maxTop)), left };
}

type JobIn = {
  id: string; title?: string | null; status?: string | null; priority?: string | null;
  scheduled_for?: string | null; scheduled_until?: string | null; estimated_duration?: string | null;
  job_type?: string | null; address?: string | null; started_at?: string | null;
  customers?: { name?: string | null } | null;
  customer_locations?: { address?: string | null } | null;
  assignments?: { profile_id: string; status?: string | null; profiles?: { full_name?: string | null; phone?: string | null } | null }[] | null;
};

/** Same-day length only. A run that finishes on another day does not invent an end clock time. */
export function sameDaySpan(startIso?: string | null, untilIso?: string | null, duration?: string | null): { end: number | null; minutes: number | null } {
  const start = jhbMinutes(startIso);
  if (untilIso && startIso && start != null) {
    const end = jhbMinutes(untilIso);
    const sd = todayInJohannesburg(new Date(startIso));
    const ed = todayInJohannesburg(new Date(untilIso));
    if (sd === ed && end != null && end > start) return { end, minutes: end - start };
  }
  const mins = intervalToMinutes(duration);
  if (mins && mins > 0 && mins <= 12 * 60 && start != null) {
    const end = start + mins;
    return end < 24 * 60 ? { end, minutes: mins } : { end: null, minutes: null };
  }
  return { end: null, minutes: null };
}

const closedStatus = (s?: string | null) => ["cancelled", "canceled", "resolved_before_visit"].includes(String(s || "").toLowerCase());

function personBits(name: string | null | undefined, sales: boolean) {
  return { assignee: tidy(name) || null, assigneeRole: (sales ? "sales" : "service") as "sales" | "service" };
}

/**
 * Calendar blocks for Today / Week / Month.
 * Jobs stay one block on scheduled_for (drag target unchanged). Each later day of a
 * multi-day run is another non-draggable block that opens the same job.
 * Lead visits with no job open the booking page.
 */
export function assembleScheduleBlocks(args: {
  jobs: JobIn[];
  entries: CalendarEntry[];
  names: Record<string, Person>;
  today: string;
}): { blocks: CalmBlock[]; people: { id: string; name: string; role: string; dot: "green" | "orange" | "grey" | "blue"; lane: "sales" | "service" }[] } {
  const people: Record<string, { id: string; name: string; role: string; dot: "green" | "orange" | "grey" | "blue"; lane: "sales" | "service" }> = {};
  const blocks: CalmBlock[] = [];
  const ensure = (id: string | null, name: string | null | undefined, sales: boolean) => {
    if (!id || people[id]) return;
    people[id] = { id, name: tidy(name) || "Assigned", role: sales ? "Sales" : "Tech", dot: "grey", lane: sales ? "sales" : "service" };
  };

  args.jobs.filter((j) => !["cancelled", "canceled"].includes(String(j.status || "").toLowerCase())).forEach((j) => {
    const card = jobToCard(j);
    const a = activeAssignee(j);
    const s = String(j.status || "").toLowerCase();
    const sales = card.lane === "sales";
    const pid = a?.profile_id || null;
    ensure(pid, a?.profiles?.full_name, sales);
    if (pid && s === "in_progress") people[pid].dot = "green";
    else if (pid && s === "dispatched" && people[pid].dot !== "green") people[pid].dot = "orange";
    const late = card.urgency.key === "late";
    const day = j.scheduled_for ? todayInJohannesburg(new Date(j.scheduled_for)) : args.today;
    const start = jhbMinutes(j.scheduled_for);
    const span = sameDaySpan(j.scheduled_for, j.scheduled_until, j.estimated_duration);
    const who = personBits(a?.profiles?.full_name, sales);
    blocks.push({
      id: j.id, uid: `job:${j.id}:${day}`, kind: "job", personId: pid, day, start,
      dur: span.minutes ?? 120, end: span.end, title: j.title || "", sub: null,
      place: card.place, block: blockKind(card, j.job_type), pill: late ? null : PILL[s] || null,
      late, draggable: s !== "completed" && !!j.scheduled_for,
      client: tidy(j.customers?.name) || null, jobType: j.job_type || null, serviceType: null,
      ...who, status: s || null, href: bookingRecordHref(j.id, null),
    });
  });

  const jobById = new Map(args.jobs.map((j) => [j.id, j]));
  for (const e of args.entries) {
    if (closedStatus(e.status)) continue;
    if (e.job_id && (e.day_count ?? 0) > 1) {
      const hit = blocks.find((b) => b.kind === "job" && b.id === e.job_id && b.day === e.date);
      if (hit) { hit.dayIndex = e.day_index ?? hit.dayIndex; hit.dayCount = e.day_count ?? hit.dayCount; continue; }
      const job = jobById.get(e.job_id);
      const card = job ? jobToCard(job) : null;
      const sales = card ? card.lane === "sales" : /sale|quote|consult/i.test(e.service_type || "");
      const pid = e.agent_id;
      const name = (pid && args.names[pid]?.full_name) || card?.assigneeName || null;
      ensure(pid, name, sales);
      const start = e.start_time ? Number(e.start_time.slice(0, 2)) * 60 + Number(e.start_time.slice(3, 5)) : null;
      const who = personBits(name, sales);
      blocks.push({
        id: e.job_id, uid: `job:${e.job_id}:${e.date}:${e.day_index ?? 0}`, kind: "job", personId: pid, day: e.date, start,
        dur: 120, title: job?.title || e.customer_name || "", place: card?.place || tidy(e.customer_address).split(",").slice(0, 2).join(", ") || null,
        block: blockKind(card || { lane: sales ? "sales" : "service", title: e.service_type || job?.title || "", statusKey: e.status || "", urgency: { key: "later", rank: 6, mins: null } }, job?.job_type || e.service_type),
        late: false, draggable: false, client: tidy(e.customer_name) || tidy(job?.customers?.name) || null,
        jobType: job?.job_type || null, serviceType: e.service_type || null, ...who, status: e.status || job?.status || null,
        dayIndex: e.day_index, dayCount: e.day_count, href: bookingRecordHref(e.job_id, e.lead_id),
      });
      continue;
    }
    if (e.job_id || !e.lead_id || !tidy(e.customer_name)) continue;
    const card = visitToCard(e, args.names);
    const sales = card.lane === "sales";
    const pid = e.agent_id;
    ensure(pid, args.names[pid || ""]?.full_name || card.assigneeName, sales);
    const start = e.start_time ? Number(e.start_time.slice(0, 2)) * 60 + Number(e.start_time.slice(3, 5)) : null;
    const late = card.urgency.key === "late";
    const who = personBits(card.assigneeName, sales);
    blocks.push({
      id: `v-${e.key}`, uid: `visit:${e.key}`, kind: "visit", personId: pid, day: e.date, start, dur: 60,
      title: e.customer_name || card.title, place: card.place, block: blockKind(card, e.service_type),
      late, pill: card.urgency.key === "done" ? "Done" : null, draggable: false,
      client: tidy(e.customer_name) || null, jobType: null, serviceType: e.service_type || null,
      ...who, status: e.status || null, dayIndex: e.day_index, dayCount: e.day_count,
      href: bookingRecordHref(null, e.lead_id),
    });
  }

  Object.values(people).forEach((p) => {
    if (p.dot === "grey" && blocks.some((b) => b.personId === p.id && b.day === args.today && b.block !== "done")) p.dot = "blue";
  });
  return {
    blocks,
    people: Object.values(people).sort((a, b) => a.role.localeCompare(b.role) * -1 || a.name.localeCompare(b.name)),
  };
}

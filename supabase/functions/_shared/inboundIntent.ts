/**
 * Intent detection for inbound customer WhatsApp replies.
 *
 * A single message can carry MORE THAN ONE intent, e.g.
 *   "botha.johan@gmail.com can we change the time to 10:30"
 * which is both an email capture AND a reschedule request. The classifier
 * therefore returns a set of flags rather than one exclusive label.
 */

const SAST_OFFSET = "+02:00";

export interface InboundIntent {
  /** Message contained an email address (may co-exist with other intents). */
  hasEmail: boolean;
  wantsReschedule: boolean;
  wantsCancel: boolean;
  isOptOut: boolean;
  isOptIn: boolean;
  /** No recognised actionable intent, but the customer said something. */
  isGeneralQuery: boolean;
}

const RESCHEDULE_PATTERNS: RegExp[] = [
  /\breschedul/i,
  /\bre-?book/i,
  /\bpostpone/i,
  /\bmove\b.*\b(appointment|booking|time|date|slot|it)\b/i,
  // "change" and the common typos customers actually send (cahange, chnage...)
  /\b(chang|cahang|chnag|chagn)\w*\b.*\b(time|date|day|appointment|booking|slot)\b/i,
  /\b(time|date|day|appointment|booking|slot)\b.*\b(chang|cahang|chnag|chagn)\w*/i,
  // "...the time to 10:30" / "...appointment to Thursday"
  /\b(time|date|day|appointment|booking|slot)\b.*\bto\b\s*(\d{1,2}\s*[:h.]?\s*\d{0,2}\s*(am|pm)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
  /\b(different|another|new|earlier|later)\b.*\b(time|date|day|slot)\b/i,
  /\bcan (we|you|i)\b.*\b(come|make it|do it)\b.*\b(later|earlier|tomorrow|instead)\b/i,
  /\bnot? (available|home|there)\b/i,
  /\bshift\b.*\b(time|appointment|booking)\b/i,
];

/** Status questions ("was the time changed?") are queries, not requests. */
const STATUS_QUESTION_PATTERNS: RegExp[] = [
  /^\s*(was|were|is|are|has|have|had|did|does|do|any update|status|when)\b/i,
  /\b(chang|mov|reschedul)\w*\s*\?\s*$/i,
];

const CANCEL_PATTERNS: RegExp[] = [
  /\bcancel\b/i,
  /\bcall (it )?off\b/i,
  /\bdon'?t (come|send|bother)\b/i,
  /\bno longer (need|require|want)\b/i,
  /\bwe'?re? (good|sorted|fine)\b.*\bthanks?\b/i,
];

const OPT_OUT = ["STOP", "UNSUBSCRIBE", "OPTOUT", "OPT OUT"];
const OPT_IN = ["START", "UNSTOP", "SUBSCRIBE"];

export function classifyInbound(body: string, hasEmail: boolean): InboundIntent {
  const text = String(body || "").trim();
  const upper = text.toUpperCase();

  const isOptOut = OPT_OUT.includes(upper);
  const isOptIn = OPT_IN.includes(upper);

  const isStatusQuestion = STATUS_QUESTION_PATTERNS.some((r) => r.test(text));

  const wantsCancel = !isOptOut && !isStatusQuestion &&
    CANCEL_PATTERNS.some((r) => r.test(text));
  const wantsReschedule = !wantsCancel && !isOptOut && !isStatusQuestion &&
    RESCHEDULE_PATTERNS.some((r) => r.test(text));


  // Everything that is left over once the email address is stripped out.
  const remainder = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "").trim();
  const hasOtherContent = remainder.replace(/[^a-z0-9]/gi, "").length > 2;

  const isGeneralQuery = !isOptOut && !isOptIn && !wantsCancel && !wantsReschedule &&
    hasOtherContent;

  return { hasEmail, wantsReschedule, wantsCancel, isOptOut, isOptIn, isGeneralQuery };
}

export interface ParsedWhen {
  /** ISO datetime when we could resolve both date and time. */
  iso: string | null;
  /** HH:MM (24h) when a time was mentioned. */
  time: string | null;
  /** YYYY-MM-DD when a date was mentioned. */
  date: string | null;
  /** Raw human phrase we matched, for the team to eyeball. */
  phrase: string | null;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Current date in SAST as Y/M/D parts. */
function sastToday(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

/**
 * Best-effort natural-language date/time extraction for SA customers.
 * Deliberately conservative — anything ambiguous is left null so a human
 * approves the change rather than us guessing.
 */
export function parseRequestedWhen(body: string, now = new Date()): ParsedWhen {
  const text = String(body || "").toLowerCase();
  let time: string | null = null;
  let date: string | null = null;
  let phrase: string | null = null;

  // ---- time ----------------------------------------------------------------
  // 10:30, 10h30, 10.30, 14:00 | 10am, 3 pm, half past not supported.
  const hm = text.match(/\b(\d{1,2})\s*[:h.]\s*(\d{2})\s*(am|pm)?\b/);
  const hOnly = text.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (hm) {
    let h = Number(hm[1]);
    const m = Number(hm[2]);
    const mer = hm[3];
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      time = `${pad(h)}:${pad(m)}`;
      phrase = hm[0].trim();
    }
  } else if (hOnly) {
    let h = Number(hOnly[1]);
    const mer = hOnly[2];
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) {
      time = `${pad(h)}:00`;
      phrase = hOnly[0].trim();
    }
  }

  // ---- date ----------------------------------------------------------------
  const { y, m, d } = sastToday(now);
  const todayUtcNoon = Date.UTC(y, m - 1, d, 12);
  const addDays = (n: number) => {
    const dt = new Date(todayUtcNoon + n * 86400000);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  };

  if (/\btoday\b/.test(text)) {
    date = addDays(0);
    phrase = phrase ? `today ${phrase}` : "today";
  } else if (/\btomorrow\b/.test(text)) {
    date = addDays(1);
    phrase = phrase ? `tomorrow ${phrase}` : "tomorrow";
  } else {
    // "13 August" / "August 13" / "13/08" / "13-08-2026"
    const dmy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    const dMonth = text.match(
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\b`),
    );
    const monthD = text.match(
      new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`),
    );
    const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));

    if (dMonth || monthD) {
      const day = Number(dMonth ? dMonth[1] : monthD![2]);
      const monthIdx = MONTHS.indexOf(dMonth ? dMonth[2] : monthD![1]);
      let year = y;
      // A date already past this year almost certainly means next year.
      if (monthIdx + 1 < m || (monthIdx + 1 === m && day < d)) year = y + 1;
      date = `${year}-${pad(monthIdx + 1)}-${pad(day)}`;
      phrase = (dMonth ? dMonth[0] : monthD![0]) + (time ? ` ${time}` : "");
    } else if (dmy) {
      const day = Number(dmy[1]);
      const month = Number(dmy[2]);
      const yr = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : y;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        date = `${yr}-${pad(month)}-${pad(day)}`;
        phrase = dmy[0] + (time ? ` ${time}` : "");
      }
    } else if (weekday >= 0) {
      const todayDow = new Date(todayUtcNoon).getUTCDay();
      let delta = (weekday - todayDow + 7) % 7;
      if (delta === 0) delta = 7;
      if (/\bnext\b/.test(text) && delta < 7) delta += 7;
      date = addDays(delta);
      phrase = WEEKDAYS[weekday] + (time ? ` ${time}` : "");
    }
  }

  const iso = date && time ? new Date(`${date}T${time}:00${SAST_OFFSET}`).toISOString() : null;

  return { iso: iso && !Number.isNaN(Date.parse(iso)) ? iso : null, time, date, phrase };
}

/** Human summary of a parsed request, used in replies and team notifications. */
export function describeWhen(when: ParsedWhen): string | null {
  if (when.date && when.time) {
    const d = new Date(`${when.date}T${when.time}:00${SAST_OFFSET}`);
    return d.toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (when.date) {
    const d = new Date(`${when.date}T09:00:00${SAST_OFFSET}`);
    return d.toLocaleDateString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  if (when.time) return `${when.time}`;
  return null;
}

/**
 * Notify every admin / dispatcher that a customer needs something.
 * Service-role client required (bypasses notification RLS).
 */
export async function notifyDispatchTeam(
  supabase: any,
  payload: {
    type: string;
    title: string;
    body: string;
    relatedId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  const { data: staff, error } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "dispatcher"]);

  if (error || !staff?.length) {
    console.error("[inboundIntent] no dispatch staff found", error);
    return 0;
  }

  const unique = Array.from(new Set(staff.map((s: any) => s.user_id)));
  const rows = unique.map((user_id) => ({
    user_id,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    related_id: payload.relatedId ?? null,
    metadata: payload.metadata ?? {},
  }));

  const { error: insertError } = await supabase.from("notifications").insert(rows);
  if (insertError) {
    console.error("[inboundIntent] notification insert failed", insertError);
    return 0;
  }
  return rows.length;
}

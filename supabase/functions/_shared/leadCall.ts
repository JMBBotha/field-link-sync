/** Pure helpers for lead-offer-call (tested in leadCall.test.ts). */
export function e164(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "27" + d.slice(1);
  return d.length >= 11 ? "+" + d : null;
}

/** Inside call hours? (SAST) */
export function inCallHours(s: { call_days: number[]; call_start: string; call_end: string }, now = new Date()): boolean {
  const z = new Date(now.getTime() + 2 * 3600_000);
  const dow = z.getUTCDay() === 0 ? 7 : z.getUTCDay();
  const hm = `${String(z.getUTCHours()).padStart(2, "0")}:${String(z.getUTCMinutes()).padStart(2, "0")}`;
  return s.call_days.includes(dow) && hm >= s.call_start.slice(0, 5) && hm < s.call_end.slice(0, 5);
}

export function spokenOffer(o: { name?: string | null; job?: string | null; area?: string | null; date?: string | null; time?: string | null; minutes?: number | null }): string {
  const first = (o.name || "").trim().split(/\s+/)[0];
  const when = o.date ? new Date(o.date + "T00:00:00Z").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "a time to be arranged";
  const dur = o.minutes ? (o.minutes >= 90 ? `about ${Math.round(o.minutes / 30) / 2} hours` : `about ${o.minutes} minutes`) : "";
  return `Hi ${first || "there"}, this is Field Lynk from zero eight hundred be cool. New ${o.job || "service"} job in ${o.area || "your area"}, ` +
    `on ${when}${o.time ? " at " + o.time.slice(0, 5) : ""}${dur ? ", " + dur : ""}. Press 1 to accept, or 2 to pass.`;
}


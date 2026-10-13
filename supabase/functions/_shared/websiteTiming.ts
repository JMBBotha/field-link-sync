// Website booking timing choice -> one "Timing: ..." note line (shown on the Field Lynk lead card).
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function timingLine(timing?: string | null, date?: string | null, time?: string | null): string {
  const t = (timing || "").toLowerCase().replace(/[\s_-]/g, "");
  if (t === "asap" || t === "assoonaspossible") return "Timing: ASAP";
  if (t === "flexible" || t === "imflexible") return "Timing: Flexible";
  if (t !== "specific" && t !== "specifictime") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return "Timing: Specific time";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const hm = /^(\d{1,2}):(\d{2})/.exec(time || "");
  return `Timing: ${DAYS[d.getUTCDay()]} ${+m[3]} ${MONTHS[+m[2] - 1]}${hm ? ` ${hm[1].padStart(2, "0")}:${hm[2]}` : ""}`;
}

/** Job pipeline panel helpers (Johan 3 Nov 14:46). */
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Assigned tech + booked time from the lead itself; null when no tech is assigned. */
export function pipelineTechLine(name?: string | null, date?: string | null, time?: string | null): { name: string; when: string } | null {
  const n = (name || "").trim();
  if (!n) return null;
  let when = "No time booked yet";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || "");
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    when = `${DAY[d.getUTCDay()]} ${+m[3]} ${MON[+m[2] - 1]}${time ? `, ${time.slice(0, 5)}` : ""}`;
  }
  return { name: n, when };
}

/** Parts rows only show when someone already set an order or parts status. */
export const partsApply = (f: { order_status?: string | null; parts_status?: string | null }) => !!(f.order_status || f.parts_status);

/** Friendly SAST date/time, e.g. "Tue 10 Nov, 08:00". */
export const friendlyWhen = (d?: string | null, t?: string | null) => {
  if (!d) return "";
  const dt = new Date(`${d}T${t ? t.slice(0, 5) : "12:00"}:00+02:00`);
  const day = dt.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  return t ? `${day}, ${t.slice(0, 5)}` : day;
};

/** Rep "my appointments" helpers (STEP 3, 2026-09-30). Rows come from the get_my_appointments RPC. */
export interface MyAppointment {
  lead_id: string;
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time: string | null; // HH:MM:SS
  customer_name: string | null;
  address: string | null;
  service_type: string | null;
  status: string | null;
  is_mine: boolean;
  source: string;
  quote_id: string | null;
  customer_id: string | null;
}

/** Soonest first: date, then time (untimed last that day), then client name. */
export function sortAppointments(rows: MyAppointment[]): MyAppointment[] {
  return [...rows].sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date < b.scheduled_date ? -1 : 1;
    const at = a.scheduled_time ?? "99:99";
    const bt = b.scheduled_time ?? "99:99";
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
  });
}

/** e.g. "Thu 1 Oct · 09:00" (or "Thu 1 Oct · time TBC"). Date-only strings are read as local dates. */
export function formatAppointmentWhen(date: string, time: string | null): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const day = dt.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${time ? time.slice(0, 5) : "time TBC"}`;
}

export function appointmentLinks(a: Pick<MyAppointment, "lead_id" | "quote_id">) {
  return {
    lead: `/admin/dispatch?lead=${a.lead_id}`,
    quote: a.quote_id ? `/admin/estimates/${a.quote_id}` : `/admin/quotes?leadId=${a.lead_id}`,
    quoteLabel: a.quote_id ? "Open quote" : "Start quote",
  };
}

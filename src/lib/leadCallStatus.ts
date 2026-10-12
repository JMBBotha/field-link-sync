/** Admin card chip text for lead offer phone calls (DB: lead_call_statuses). Never used to filter leads. */
export type LeadCallStatus = { lead_id: string; state: string; person: string | null; at: string | null; n_passed: number; n_no_answer: number; n_called: number; dry_run: boolean };

const t = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 2 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export function callChip(s?: LeadCallStatus | null): { text: string; tone: "green" | "blue" | "amber" | "grey" } | null {
  if (!s) return null;
  const extra = [s.n_passed ? `${s.n_passed} passed` : "", s.n_no_answer ? `${s.n_no_answer} no answer` : ""].filter(Boolean).join(", ");
  switch (s.state) {
    case "accepted": return { text: `Accepted by ${s.person ?? "staff"} by phone at ${t(s.at)}`, tone: "green" };
    case "calling": return { text: `Calling ${s.person ?? "staff"}…${extra ? ` (${extra})` : ""}`, tone: "blue" };
    case "queued": return { text: `Phoning staff${extra ? ` (${extra})` : ""}`, tone: "blue" };
    case "dry_run": return { text: `Test run: would phone ${s.n_called}`, tone: "grey" };
    case "not_called": return { text: `Not phoned: ${s.person ?? "no one eligible"}`, tone: "grey" };
    default: return { text: extra ? `Phoned ${s.n_called}: ${extra}` : `Phoned ${s.n_called}, no one accepted`, tone: "amber" };
  }
}

export const statusesByLead = (rows: LeadCallStatus[] | null | undefined) => new Map((rows ?? []).map((r) => [r.lead_id, r]));

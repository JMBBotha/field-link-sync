// Job type choice (Johan 3 Nov 2026, approved 14:15). One required choice, no default:
//   service      = AC service call-out / repair -> request "service", intent service, job_type "service"
//   installation = new AC                       -> request "new_sale", intent sales, job_type "quote" until the
//                                                 quote is accepted, then "installation" (Johan answer 1).
// Decided (Johan 14:17/14:18): repair is part of service (one type); Move stays its own request type. No on-site
// service->installation conversion: an approved type change only changes the type label. The tech's sales button
// has two options (unit not viable -> call-out closed + replacement quote lead; client also needs a new quote).
// No lead credit or commission: leads only record raised_by_tech for reporting.
import { supabase } from "@/integrations/supabase/client";

export type JobKind = "service" | "installation";

export const CALL_OUT_EXCL_VAT = 680;
export const CALL_OUT_NOTE = "R680 excl. VAT call-out per technician visit, charged separately, never deducted from the repair or any quote.";

export const JOB_KIND_META: Record<JobKind, { icon: string; title: string; request: string; requestLabel: string; hint: string; note: string; next: string }> = {
  service: {
    icon: "🔧", title: "AC service call-out / repair", request: "service", requestLabel: "Service",
    hint: "Not cooling, leaking, noise, maintenance", note: CALL_OUT_NOTE, next: "Next: tech scheduling",
  },
  installation: {
    icon: "❄️", title: "Installation (new AC)", request: "new_sale", requestLabel: "New sale",
    hint: "New unit, extra room, replace old unit", note: "Free sales site visit for the quote", next: "Next: rep offer (or the client's own rep), then the quote",
  },
};

/** Lead form: the existing service_type wording, so lane/intent routing (leadLane.ts) is unchanged. */
export const leadServiceTypeFor = (k: JobKind) => (k === "service" ? "Technical/Repairs" : "Sales/Consultation");

/** Job row: installation stays "quote" until its quote has status "accepted" (Johan answer 1). */
export const jobTypeFor = (k: JobKind, hasAcceptedQuote = false) => (k === "service" ? "service" : hasAcceptedQuote ? "installation" : "quote");

/** Which card a stored job_type belongs to. */
export function kindOfJobType(t?: string | null): JobKind | null {
  const s = (t || "").toLowerCase();
  if (["quote", "installation", "survey", "quote_request", "sales", "consultation"].includes(s)) return "installation";
  if (["service", "service_call", "repair", "maintenance"].includes(s)) return "service";
  return null;
}

/** What the tech sees on the job sheet. */
export function techJobTypeLabel(t?: string | null): string {
  const s = (t || "").toLowerCase();
  if (s === "installation") return "❄️ Installation";
  if (kindOfJobType(s) === "installation") return "❄️ Quote (installation)";
  if (kindOfJobType(s) === "service") return "🔧 Service call-out / repair";
  return t || "Not set";
}

// Booking confirmation templates (Johan answer 4). Template text only: nothing here sends anything,
// and WhatsApp stays off. The call-out line is added for service / repair bookings only.
export interface BookingMsg { firstName?: string | null; kind: JobKind | null; day: string; time?: string | null; company?: string }
const callOutLine = (k: JobKind | null) => (k === "service" ? ` Please note: ${CALL_OUT_NOTE}` : "");
export function bookingSms(m: BookingMsg): string {
  const what = m.kind === "installation" ? "free sales site visit" : "technician visit";
  return `Hi ${m.firstName || "there"}, your ${m.company || "0800-BE-COOL"} ${what} is booked for ${m.day}${m.time ? ` at ${m.time}` : ""}.${callOutLine(m.kind)} Reply to change it.`;
}
export function bookingEmail(m: BookingMsg): { subject: string; html: string } {
  const what = m.kind === "installation" ? "free sales site visit" : "technician visit";
  const fee = m.kind === "service" ? `<p style="background:#FFF4E5;border:1px solid #F5B66B;border-radius:8px;padding:10px"><b>Call-out fee:</b> ${CALL_OUT_NOTE}</p>` : "";
  return {
    subject: `Your ${what} is booked – ${m.day}`,
    html: `<p>Hi ${m.firstName || "there"},</p><p>Your ${what} is booked for <b>${m.day}${m.time ? ` at ${m.time}` : ""}</b>.</p>${fee}<p>Reply to this email if you need to change it.</p>`,
  };
}

// Tech change requests (Johan answer 5): a tech never changes the type directly. Change = request + reason;
// nothing changes until an admin/owner approves; the tech sees "Waiting for admin".
export interface TypeChangeRequest { id: string; job_id: string; from_type: string | null; to_type: string; reason: string; status: "pending" | "approved" | "declined"; created_at: string; decided_at?: string | null }
type Res = { ok: boolean; message?: string; request_id?: string; lead_id?: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => { const { data, error } = await (supabase.rpc as any)(fn, args); if (error) throw new Error(error.message); return data as T; };
export const requestTypeChange = (jobId: string, to: JobKind, reason: string) => rpc<Res>("request_job_type_change", { p_job_id: jobId, p_to: to, p_reason: reason });
export const decideTypeChange = (requestId: string, approve: boolean, note?: string) => rpc<Res>("decide_job_type_change", { p_request_id: requestId, p_approve: approve, p_note: note ?? null });
export const flagSalesLead = (jobId: string, note: string) => rpc<Res>("tech_flag_sales_lead", { p_job_id: jobId, p_note: note || null });
export async function latestTypeChange(jobId: string): Promise<TypeChangeRequest | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from as any)("job_type_change_requests").select("id, job_id, from_type, to_type, reason, status, created_at, decided_at")
    .eq("job_id", jobId).order("created_at", { ascending: false }).limit(1);
  return (data && data[0]) || null;
}
export const isAcceptedQuote = (status?: string | null) => (status || "").toLowerCase() === "accepted";
export async function quoteStatus(quoteId: string): Promise<string | null> {
  const { data } = await supabase.from("quotes").select("status").eq("id", quoteId).maybeSingle();
  return (data as { status?: string } | null)?.status ?? null;
}
/** Unit not viable: closes the service job as a call-out (R680 excl. VAT, never deducted) + replacement-quote lead. */
export const unitNotViable = (jobId: string, note: string) => rpc<Res>("tech_unit_not_viable", { p_job_id: jobId, p_note: note || null });
export const validReason = (r: string) => r.trim().length >= 3;

/**
 * Company routing and end-of-call dedup for a Vapi phone booking.
 *
 * book-appointment used to insert the customer and the lead with company_id
 * null, so the company could not see them (leads RLS is company_id =
 * get_user_company_id) and no job was created. End-of-call dedup filters on
 * the line's company, missed that row, and opened a second "Unknown Caller".
 *
 * The company is phone_route_company(business line, assistant id) — the same
 * RPC arguments the end-of-call path sends. Dedup then prefers a lead in that
 * company tagged with this Vapi call id, else the same caller phone created
 * during the call (last 30 minutes).
 */

/** Spoken line already used when a booking cannot be saved. */
export const OFFICE_WILL_PHONE_BACK =
  "Booking failed on our side. Apologise and say the office will phone back to confirm the appointment.";

/** Client-side stand-in used when a line does not route. Never a real company. */
export const UNROUTED_COMPANY_ID = "00000000-0000-0000-0000-000000000000";

/** How long after a booking the end-of-call report still belongs to that lead. */
export const CALL_LEAD_WINDOW_MS = 30 * 60 * 1000;

const PLACEHOLDER_NAME = /^(unknown(\s+caller)?|phone\s+caller|caller|anonymous|n\/a|na|none|no name)$/i;
const PLACEHOLDER_ADDRESS = /^address (pending|to be confirmed)\b/i;

export function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** call.phoneNumber.number — the business line, not the caller. */
export function businessLineNumber(phoneNumber: unknown): string | null {
  if (typeof phoneNumber === "string") return asText(phoneNumber);
  if (phoneNumber && typeof phoneNumber === "object" && "number" in phoneNumber) {
    return asText((phoneNumber as { number?: unknown }).number);
  }
  return null;
}

/**
 * Arguments for public.phone_route_company, matching the end-of-call call:
 * rpc("phone_route_company", { p_business_phone, p_assistant_id }).
 */
export function phoneRouteArgs(
  businessPhone: unknown,
  assistantId: unknown,
): { p_business_phone: string | null; p_assistant_id: string | null } {
  return {
    p_business_phone: asText(businessPhone),
    p_assistant_id: asText(assistantId),
  };
}

/** A routed company id, or null when the line is not set up. */
export function routedCompanyId(routed: unknown): string | null {
  const id = asText(routed);
  if (!id || id === UNROUTED_COMPANY_ID) return null;
  return id;
}

/**
 * Company to stamp on the customer, lead, and job. No route → the existing
 * office-will-phone-back failure, and the caller must not insert anything.
 */
export function bookingCompanyOrRefuse(routed: unknown): { companyId: string } | { refuse: string } {
  const companyId = routedCompanyId(routed);
  if (!companyId) return { refuse: OFFICE_WILL_PHONE_BACK };
  return { companyId };
}

/**
 * Body forwarded to book-appointment. Line, assistant, and Vapi call id come
 * from the call payload and overwrite anything the model put in the tool args.
 */
export function bookAppointmentForwardBody(
  params: Record<string, unknown> | null | undefined,
  ctx: {
    callerPhone?: unknown;
    businessPhone?: unknown;
    assistantId?: unknown;
    vapiCallId?: unknown;
  },
): Record<string, unknown> {
  const src = params && typeof params === "object" ? params : {};
  const toolPhone = asText(src.phone_number);
  const caller = asText(ctx.callerPhone);
  return {
    ...src,
    phone_number: toolPhone || caller || "",
    business_phone: asText(ctx.businessPhone),
    assistant_id: asText(ctx.assistantId),
    vapi_call_id: asText(ctx.vapiCallId),
  };
}

/** SA numbers as +27…, the form end-of-call already stores for the caller. */
export function storedCallerPhone(phone: unknown): string {
  let digits = String(asText(phone) || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) digits = "27" + digits.slice(1);
  else if (!digits.startsWith("27") && digits.length === 9) digits = "27" + digits;
  return "+" + digits;
}

export function isPlaceholderName(name: unknown): boolean {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  return !n || PLACEHOLDER_NAME.test(n);
}

export function isPlaceholderAddress(address: unknown): boolean {
  const a = String(address ?? "").trim();
  return !a || PLACEHOLDER_ADDRESS.test(a);
}

/** Append `Vapi call: <id>` once so end-of-call can find the lead this call wrote. */
export function withVapiCallNote(notes: unknown, callId: unknown): string {
  const base = String(notes ?? "").trim();
  const id = asText(callId);
  if (!id) return base;
  if (base.toLowerCase().includes(id.toLowerCase())) return base;
  const line = `Vapi call: ${id}`;
  return base ? `${base}\n${line}` : line;
}

export type InCallLead = {
  id: string;
  company_id?: string | null;
  customer_id?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  notes?: string | null;
  created_at?: string | null;
  service_type?: string | null;
  priority?: string | null;
};

export function notesHaveCallId(notes: unknown, callId: unknown): boolean {
  const id = asText(callId);
  if (!id || id.length < 8) return false;
  return String(notes ?? "").toLowerCase().includes(id.toLowerCase());
}

/** Last 9 digits, so 082… and +27… are the same SA caller. */
export function callerPhoneTail(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-9);
}

export function sameCallerPhone(a: unknown, b: unknown): boolean {
  const left = callerPhoneTail(a);
  const right = callerPhoneTail(b);
  return left.length >= 9 && left === right;
}

export function createdDuringCall(createdAt: unknown, nowMs: number, windowMs = CALL_LEAD_WINDOW_MS): boolean {
  if (typeof createdAt !== "string" || !createdAt) return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age <= windowMs;
}

function newest<T extends InCallLead>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

/**
 * Lead in THIS company created during the call.
 * Call id in the notes wins (the booking may have stored a different number).
 * Otherwise the same caller phone created within the last 30 minutes.
 * A null company_id never matches — that row is invisible and must not be reused.
 */
export function matchInCallLead<T extends InCallLead>(
  rows: T[],
  query: { companyId: unknown; callId?: unknown; callerPhone?: unknown; nowMs: number },
): T | null {
  const companyId = routedCompanyId(query.companyId);
  if (!companyId) return null;
  const mine = rows.filter((row) => row.company_id === companyId);
  const byCall = mine.filter((row) => notesHaveCallId(row.notes, query.callId));
  if (byCall.length) return newest(byCall);
  const byPhone = mine.filter(
    (row) => sameCallerPhone(row.customer_phone, query.callerPhone) && createdDuringCall(row.created_at, query.nowMs),
  );
  return newest(byPhone);
}

/**
 * End-of-call update. Fills a placeholder name or address from the call and
 * leaves a name/address the booking already stored (never "Unknown Caller"
 * over a real caller, never a blank address over the booked one).
 */
export function fillLeadFromCall(
  existing: {
    notes?: string | null;
    service_type?: string | null;
    priority?: string | null;
    customer_address?: string | null;
    customer_name?: string | null;
  },
  incoming: {
    notes: string;
    serviceType?: string | null;
    priority?: string | null;
    address?: string | null;
    name?: string | null;
  },
): Record<string, string> {
  const patch: Record<string, string> = { notes: incoming.notes };
  if ((!existing.service_type || existing.service_type === "General Inquiry") && incoming.serviceType) {
    patch.service_type = incoming.serviceType;
  }
  if ((!existing.priority || existing.priority === "medium") && incoming.priority) {
    patch.priority = incoming.priority;
  }
  const address = asText(incoming.address);
  if (address && !isPlaceholderAddress(address) && isPlaceholderAddress(existing.customer_address)) {
    patch.customer_address = address;
  }
  const name = asText(incoming.name);
  if (name && !isPlaceholderName(name) && isPlaceholderName(existing.customer_name)) {
    patch.customer_name = name;
  }
  return patch;
}

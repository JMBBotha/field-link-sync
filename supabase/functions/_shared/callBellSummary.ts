// Short 2-4 line bell summary for a phone call (Johan 14:03). Pure function: no Deno APIs, unit-tested in vitest.
// Uses the Vapi summary; never the transcript (the transcript stays on the lead / call record).
export interface CallBellInput {
  callerName: string | null;
  callerPhone: string | null;
  isExistingClient: boolean;
  category: string | null;
  serviceType: string | null;
  urgency: string | null;
  area: string | null;
  summary: string | null;
}

const SALES = /(quote|quotation|estimate|pricing|price|new unit|new install|installation|buy|purchase)/i;

function firstSentence(s: string, max = 140): string {
  const t = s.replace(/\s+/g, " ").trim()
    .replace(/^(the )?(user|caller|customer) (called|phoned|rang) (in )?(to |about |regarding )?/i, "");
  const one = (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();
  const cap = one.charAt(0).toUpperCase() + one.slice(1);
  return cap.length > max ? `${cap.slice(0, max - 1).trimEnd()}…` : cap;
}

export function callKind(i: Pick<CallBellInput, "category" | "serviceType" | "summary">): "Sales" | "Service" {
  return SALES.test(`${i.category ?? ""} ${i.serviceType ?? ""} ${i.summary ?? ""}`) ? "Sales" : "Service";
}

export function nextStep(i: CallBellInput): string {
  const s = `${i.summary ?? ""}`.toLowerCase();
  if (/reschedul|moved the appointment|booked|confirmed the appointment/.test(s)) return "Confirm the booking with the customer";
  if (callKind(i) === "Sales") return "Call back with a quote";
  if ((i.urgency ?? "").match(/emergency|same_day|urgent/i)) return "Send a technician today";
  return "Book a technician";
}

export function buildCallBellBody(i: CallBellInput): string {
  const who = (i.callerName || "Unknown caller").trim();
  const kind = callKind(i);
  const line1 = [who, i.callerPhone || "no number", kind, i.isExistingClient ? "Existing client" : "New caller"].join(" · ");
  const line2 = i.summary ? `Wants: ${firstSentence(i.summary)}` : "Wants: summary pending (see transcript on the lead)";
  const urg = (i.urgency || "standard").replace(/_/g, " ");
  const line3 = `${i.area ? `Area: ${i.area.slice(0, 60)} · ` : ""}Urgency: ${urg}`;
  const line4 = `Next: ${nextStep(i)}`;
  return [line1, line2, line3, line4].join("\n");
}

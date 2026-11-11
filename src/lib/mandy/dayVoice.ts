/**
 * Day-to-day Mandy: voice confirm before a write, and the words she may say
 * from read-only checks. Writes themselves go through the existing RPCs.
 */

export const CANNOT_YET =
  'If no tool and no playbook entry covers the request, say "I can\'t do that yet, I\'ll pass it on" and call report_problem. Do not guess, and never edit company details.';

const YES = /^(yes|yeah|yep|yup|ok|okay|confirm|do it|go ahead|please do|that's right|that is right)\b/i;
const NO = /^(no|nope|cancel|stop|don't|do not|never mind|nevermind)\b/i;

export function isVoiceYes(utterance: string): boolean {
  return YES.test((utterance || "").trim());
}
export function isVoiceNo(utterance: string): boolean {
  return NO.test((utterance || "").trim());
}

/** A pending confirm card is the only thing "yes" may run. */
export function applyVoiceConfirm(hasPending: boolean, utterance: string): "run" | "cancel" | "ignore" {
  if (!hasPending) return "ignore";
  if (isVoiceYes(utterance)) return "run";
  if (isVoiceNo(utterance)) return "cancel";
  return "ignore";
}

export function confirmQuestion(detail: string): string {
  const d = detail.replace(/[?.!]+$/, "").trim();
  return `${d}, yes?`;
}

export interface LeadWait {
  name: string;
  accepted: boolean;
  assigned: boolean;
  offerCount: number;
  pendingOffers: number;
  flag?: string | null;
}

export function explainLeadWaiting(lead: LeadWait): string {
  if (lead.accepted) return `${lead.name} has already been accepted.`;
  if (lead.assigned) return `${lead.name} is assigned, but nobody has accepted the offer yet.`;
  if (lead.flag === "needs_time") return `${lead.name} has not been offered because it still needs an appointment time.`;
  if (lead.flag === "no_location") return `${lead.name} has not been offered because it has no location. Location stays hidden until a lead is accepted.`;
  if (lead.flag === "no_rep_fits") return `${lead.name} has not been offered because no salesperson is free nearby. Offers go to the 3 to 5 best matches, then widen every 2 minutes.`;
  if (lead.flag === "rep_no_base") return `${lead.name} is waiting because a salesperson has no base set, so they cannot be matched.`;
  if (lead.pendingOffers > 0) return `${lead.name} is in an offer now (${lead.pendingOffers} still open). A new lead is offered for 5 minutes. Johan is alerted at 10 minutes if nobody accepts.`;
  if (lead.offerCount > 0) return `${lead.name} was offered ${lead.offerCount} time${lead.offerCount === 1 ? "" : "s"} and is still unaccepted.`;
  return `${lead.name} has not been offered yet. A new lead goes to the 3 to 5 best-matched people for 5 minutes, then widens every 2 minutes.`;
}

export interface UnpaidRow { label: string; amount: number; status: string }

export function unpaidSentence(who: string, rows: UnpaidRow[], money: (n: number) => string): string {
  if (!rows.length) return `Nothing unpaid for ${who}.`;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const top = rows.slice(0, 3).map((r) => `${r.label} ${money(r.amount)} ${r.status}`);
  return `${who} has ${rows.length} unpaid invoice${rows.length === 1 ? "" : "s"}, ${money(total)} together: ${top.join("; ")}.`;
}

export interface DayJob { title: string; when: string }
export interface DayMaterial { name: string; qty: string }

export function techDaySentence(tech: string, jobs: DayJob[], materials: DayMaterial[]): string {
  if (!jobs.length) return `${tech} has no jobs today.`;
  const jobBit = jobs.slice(0, 4).map((j) => `${j.when} ${j.title}`).join("; ");
  const matBit = materials.length
    ? ` Materials: ${materials.slice(0, 6).map((m) => `${m.qty} ${m.name}`).join(", ")}.`
    : " No materials are listed on those jobs.";
  return `${tech} has ${jobs.length} job${jobs.length === 1 ? "" : "s"} today: ${jobBit}.${matBit}`;
}

export interface PlaybookEntry { title: string; when_to_use: string; answer: string }

/** Trimmed block for the session prompt. Company rows and role filtering happen before this. */
export function playbookBlock(entries: PlaybookEntry[], max = 1600): string {
  const parts: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `${e.title}: ${e.answer}`.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (used + line.length + 1 > max) break;
    parts.push(line);
    used += line.length + 1;
  }
  return parts.join("\n");
}

const turns: string[] = [];
export function noteMandyTurn(user: string, mandy: string) {
  if (user) turns.push(`User: ${user}`.slice(0, 300));
  if (mandy) turns.push(`Mandy: ${mandy}`.slice(0, 300));
  while (turns.length > 8) turns.shift();
}
export function recentMandyTurns(): string {
  return turns.join("\n").slice(0, 2000);
}

export const DAY_WRITES = ["set_owner_rep", "undo_owner_rep", "assign_lead_technician", "cancel_visit", "reschedule_visit"] as const;
export const DAY_READS = ["why_lead_waiting", "unpaid_for", "tech_day"] as const;

const s = (description: string) => ({ type: "string", description });
export const DAY_ACTION_SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  set_owner_rep: {
    description: "Move a client to another salesperson. Admin only. Uses set_customer_owner_rep (the owner-rep log). Always ask 'yes?' before it runs. Never edits company details.",
    parameters: { type: "object", properties: { client: s("Client name"), to_rep: s("Salesperson to move them to"), reason: s("Why, short") }, required: ["client", "to_rep"], additionalProperties: false },
  },
  undo_owner_rep: {
    description: "Put the client's salesperson back to whoever they were before the last voice move. Admin only. Same set_customer_owner_rep RPC.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  assign_lead_technician: {
    description: "Assign or change the technician on a service lead. Uses assign_lead_to_tech, or request_lead_reassignment when a salesperson cannot change an already assigned lead. Salespeople only get technicians sales_may_book_tech allows. Always ask 'yes?' first.",
    parameters: { type: "object", properties: { lead: s("Client or lead name"), technician: s("Technician name"), date: s("YYYY-MM-DD"), start: s("HH:MM"), end: s("HH:MM") }, required: ["lead", "technician"], additionalProperties: false },
  },
  cancel_visit: {
    description: "Cancel a visit with a reason (cancelled by client, no longer needed, or no-show). Uses cancel_booking_visit. The lead and quotes stay open. No invoice and no call-out. Always ask 'yes?' first.",
    parameters: { type: "object", properties: { lead: s("Client or lead name"), reason: s("cancelled by client | no longer needed | no-show"), note: s("Optional note") }, required: ["lead", "reason"], additionalProperties: false },
  },
  reschedule_visit: {
    description: "Move a booking visit to another day or time. Uses booking_visits then set_booking_visits. Always ask 'yes?' first.",
    parameters: { type: "object", properties: { lead: s("Client or lead name"), date: s("New YYYY-MM-DD"), start: s("HH:MM"), end: s("HH:MM") }, required: ["lead", "date"], additionalProperties: false },
  },
  why_lead_waiting: {
    description: "Read-only. Why a lead has not been accepted or offered. Uses the lead row, lead_offers, and get_lead_offer_flags.",
    parameters: { type: "object", properties: { lead: s("Client or lead name") }, required: ["lead"], additionalProperties: false },
  },
  unpaid_for: {
    description: "Read-only. What is unpaid on a client or job. Lists invoices that are not paid, void, or draft.",
    parameters: { type: "object", properties: { client: s("Client name"), job: s("Job title if they named a job") }, additionalProperties: false },
  },
  tech_day: {
    description: "Read-only. Today's jobs and the materials list for a technician. Uses job_schedules and get_job_packing_list. No prices.",
    parameters: { type: "object", properties: { technician: s("Technician name; empty means the signed-in user") }, additionalProperties: false },
  },
  report_problem: {
    description: "Pass something Mandy cannot do, or a bug, to the build team. Say you will pass it on, then call this. Does not change any record.",
    parameters: { type: "object", properties: { summary: s("What to pass on, one or two sentences") }, required: ["summary"], additionalProperties: false },
  },
};

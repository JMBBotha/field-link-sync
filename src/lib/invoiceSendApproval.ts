import { supabase } from "@/integrations/supabase/client";
import { formatRand } from "@/utils/formatRand";

/**
 * Accept -> draft invoice -> rep + company admins alerted -> auto-send after N min (company_settings.invoice_auto_send_minutes,
 * default 15) unless someone taps "Send invoice now" or "Hold". DB side: drizzle 0025_accept_invoice_approval.
 * The same sendInvoiceNow() is used by the alert, the attention panel, the bell toast and the AcceptGuideDialog "Send invoice?" step.
 */
export const ACCEPT_ALERT_TYPE = "quote_accepted_send_invoice";
export const SEND_BLOCKED_TYPE = "invoice_send_blocked";
export const DEFAULT_AUTO_SEND_MINUTES = 15;

export type ApprovalStatus = "pending" | "held" | "sent" | "blocked" | "cancelled";
export interface InvoiceSendApproval {
  id: string;
  invoice_id: string;
  quote_id: string | null;
  client_name: string | null;
  quote_number: string | null;
  invoice_number: string | null;
  deposit_amount: number | null;
  status: ApprovalStatus;
  due_at: string | null;
  decision: string | null;
  decided_by: string | null;
  decided_at: string | null;
  hold_reason: string | null;
  last_error: string | null;
  created_at: string;
}

export type SendResult = "sent" | "already_sent" | "held" | "already_held" | "no_approval" | `blocked:${string}`;

const TZ = "Africa/Johannesburg";
export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));

export const fmtRand = (n: number | null | undefined) => formatRand(Number(n) || 0);

export const minutesLeft = (dueAt: string | null, now: number = Date.now()) =>
  dueAt ? Math.max(0, Math.ceil((new Date(dueAt).getTime() - now) / 60000)) : null;

export const alertTitle = (a: Pick<InvoiceSendApproval, "client_name" | "quote_number">) =>
  `${a.client_name || "Client"} accepted ${a.quote_number || "the quote"}`;

/** One line under the alert title: what happens next. */
export function statusLine(a: InvoiceSendApproval, now: number = Date.now()): string {
  if (a.status === "held") return `On hold${a.decided_at ? ` since ${fmtTime(a.decided_at)}` : ""}${a.hold_reason ? ` · ${a.hold_reason}` : ""}. Won't send until someone sends it.`;
  if (a.status === "blocked") return `Didn't send: ${a.last_error || "check the invoice"}. Fix it, then send.`;
  if (a.status === "sent") return "Sent to the client.";
  if (a.status === "cancelled") return "Invoice voided.";
  if (!a.due_at) return "Auto-send is off. Nothing has been sent yet.";
  const m = minutesLeft(a.due_at, now)!;
  return m <= 0 ? "Sending now…" : `Sends automatically at ${fmtTime(a.due_at)} (in ${m} min)`;
}

export function resultMessage(r: SendResult | string): { ok: boolean; text: string } {
  if (r === "sent") return { ok: true, text: "Invoice sent to the client" };
  if (r === "already_sent") return { ok: true, text: "Already sent, nothing sent twice" };
  if (r === "held") return { ok: true, text: "On hold. It won't send until someone sends it." };
  if (r === "already_held") return { ok: true, text: "Already on hold" };
  if (r === "no_approval") return { ok: false, text: "This invoice has no pending send" };
  if (r.startsWith("blocked:")) return { ok: false, text: `Not sent: ${r.slice(8)}` };
  return { ok: false, text: String(r) };
}

const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

export async function sendInvoiceNow(invoiceId: string): Promise<SendResult> {
  const { data, error } = await rpc.call(supabase, "invoice_send_now", { p_invoice_id: invoiceId });
  if (error) throw new Error(error.message);
  return (data?.result ?? "sent") as SendResult;
}

export async function holdInvoiceSend(invoiceId: string, reason?: string | null): Promise<SendResult> {
  const { data, error } = await rpc.call(supabase, "invoice_send_hold", { p_invoice_id: invoiceId, p_reason: reason ?? null });
  if (error) throw new Error(error.message);
  return (data?.result ?? "held") as SendResult;
}

/** Order: needs a decision soonest first, then held/blocked. */
export const sortApprovals = (rows: InvoiceSendApproval[]) =>
  [...rows].sort((a, b) => {
    const rank = (x: InvoiceSendApproval) => (x.status === "pending" ? 0 : x.status === "blocked" ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const t = (x: InvoiceSendApproval) => new Date(x.due_at || x.decided_at || x.created_at).getTime();
    return t(a) - t(b);
  });

/**
 * Job / warranty card email. No prices. Sent only when autoSend is exactly true.
 * From Johan's mailbox on the verified domain. No imports outside supabase/functions.
 */
import { STAFF_ALERT_FROM_EMAIL } from "./leadEmailAlert.ts";

export const JOB_CARD_FROM_EMAIL = STAFF_ALERT_FROM_EMAIL;
export const JOB_CARD_FROM_NAME = "Massair CT (Pty) Ltd";
export const JOB_CARD_BAR = "#3D9BE8";
export const JOB_CARD_ACCENT = "#C2410C";

export interface JobCardEmailInput {
  autoSend: boolean;
  to: string | null;
  clientName: string | null;
  jobTitle: string | null;
  completedLabel: string;
  signed: boolean;
  pdfBase64: string | null;
}

export type JobCardEmail =
  | { send: false; reason: "auto_send_off" | "no_recipient" | "no_pdf" }
  | {
      send: true;
      to: string;
      subject: string;
      html: string;
      fromEmail: string;
      fromName: string;
      filename: string;
      pdfBase64: string;
    };

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function buildJobCardEmail(input: JobCardEmailInput): JobCardEmail {
  if (input.autoSend !== true) return { send: false, reason: "auto_send_off" };
  const to = String(input.to || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { send: false, reason: "no_recipient" };
  if (!input.pdfBase64) return { send: false, reason: "no_pdf" };
  const who = String(input.clientName || "").trim();
  const job = String(input.jobTitle || "your job").trim() || "your job";
  const subject = `Job / warranty card - ${who || job}`.slice(0, 140);
  const signedLine = input.signed
    ? "It was signed on site."
    : "It was issued without a signature on site (Not signed by client).";
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;background:#eef3f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
<tr><td style="background:${JOB_CARD_BAR};padding:18px 24px;color:#ffffff;font-size:20px;font-weight:800;">Job / warranty card</td></tr>
<tr><td style="padding:22px 24px;color:#1d2a3a;font-size:14px;line-height:1.5;">
<p style="margin:0 0 12px;">${who ? `Hi ${esc(who)},` : "Hello,"}</p>
<p style="margin:0 0 12px;">Your job / warranty card is attached. It records the work done, the units and the warranty. Please keep it with your records.</p>
<p style="margin:0 0 12px;"><b>Job:</b> ${esc(job)}<br/><b>Completed:</b> ${esc(input.completedLabel || "")}</p>
<p style="margin:0 0 12px;">${esc(signedLine)}</p>
<p style="margin:0;">Photos in the card are kept as the record of this job.</p>
</td></tr>
<tr><td style="background:#f2f9fe;padding:12px 24px;font-size:11px;color:#6b7a8c;">This email and the attached card are confidential and intended only for the client named above. &copy; ${new Date().getFullYear()} ${esc(JOB_CARD_FROM_NAME)}.</td></tr>
</table></td></tr></table></body></html>`;
  return {
    send: true,
    to,
    subject,
    html,
    fromEmail: JOB_CARD_FROM_EMAIL,
    fromName: JOB_CARD_FROM_NAME,
    filename: "Job-warranty-card.pdf",
    pdfBase64: input.pdfBase64,
  };
}

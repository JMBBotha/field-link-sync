/**
 * Edited wording on an existing send preview is what the send call carries.
 * Attachments, totals and recipients stay with the caller.
 */
import { FINAL_INVOICE_DEFAULT_MESSAGE } from "@/lib/brandedEmail";

export { FINAL_INVOICE_DEFAULT_MESSAGE };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Plain text of a preview html, so a textarea can start from the email the server built. */
export function htmlToPlainMessage(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Safe html for a booking email whose wording the office changed. */
export function plainMessageToEmailHtml(text: string): string {
  const paras = text.trim().split(/\n{2,}/).filter((p) => p.trim())
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<html><body><div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#1f2937">${paras}</div></body></html>`;
}

export function canSendEditedEmail(subject: string, body: string): boolean {
  return subject.trim().length > 0 && body.trim().length > 0;
}

/** Args for send_final_invoice_email. The trimmed subject and message are the ones that send. */
export function finalInvoiceSendPayload(invoiceId: string, to: string, subject: string, message: string) {
  return {
    p_invoice: invoiceId,
    p_to: to,
    p_mode: "send" as const,
    p_subject: subject.trim(),
    p_message: message.trim(),
  };
}

/** Args for send_booking_confirmation. Nulls keep the server template (unchanged preview). */
export function bookingSendPayload(jobId: string, to: string, subject: string, body: string, original: { subject: string; body: string }) {
  const edited = subject.trim() !== original.subject.trim() || body.trim() !== original.body.trim();
  return {
    p_job_id: jobId,
    p_mode: "send" as const,
    p_to: to,
    p_subject: edited ? subject.trim() : null,
    p_body: edited ? body.trim() : null,
  };
}

/** Subject and message passed to send-quote-email. Empty message stays optional. */
export function quoteSendFields(subject: string, message: string) {
  return { subject: subject.trim(), message: message.trim() || undefined };
}

/** The first paragraph after "Dear …" is the editable note on a draft-invoice email. */
export function draftInvoiceMessageFromHtml(html: string): string {
  const m = String(html || "").match(/Dear[\s\S]*?<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/i);
  return m ? htmlToPlainMessage(m[1]) : "";
}

/** Replace that note and leave the invoice table, totals and pay link alone. */
export function replaceDraftInvoiceMessage(html: string, message: string): string {
  const paras = message.trim().split(/\n{2,}/).filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 12px;font-size:14px;color:#374151;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  if (!paras) return html;
  if (/Dear[\s\S]*?<\/p>\s*<p[^>]*>[\s\S]*?<\/p>/i.test(html)) {
    return html.replace(/(Dear[\s\S]*?<\/p>\s*)<p[^>]*>[\s\S]*?<\/p>/i, `$1${paras}`);
  }
  if (/Dear[\s\S]*?<\/p>/i.test(html)) return html.replace(/(Dear[\s\S]*?<\/p>)/i, `$1${paras}`);
  return `${paras}${html}`;
}

export function draftInvoiceHtmlForSend(baseHtml: string, message: string, originalMessage: string): string {
  if (!message.trim() || message.trim() === originalMessage.trim()) return baseHtml;
  return replaceDraftInvoiceMessage(baseHtml, message);
}

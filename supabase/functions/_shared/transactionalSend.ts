/** Verified sending domain for Field Lynk mail (Resend). */
export const SENDING_DOMAIN = "0800becool.co.za";

const FALLBACK_FROM = "0800-BE-COOL <wcquotes@0800becool.co.za>";

/**
 * From address for one transactional email.
 * A company profile address is used only when it is on the verified domain
 * (Massair CT's profile address is johan@0800becool.co.za). Anything else
 * stays on the configured EMAIL_FROM mailbox.
 */
export function transactionalFrom(input: { envFrom?: string | null; fromEmail?: string | null; fromName?: string | null }): string {
  const fallback = (input.envFrom || "").trim() || FALLBACK_FROM;
  const email = String(input.fromEmail || "").trim().toLowerCase();
  if (!new RegExp(`^[^@\\s]+@${SENDING_DOMAIN.replace(/\./g, "\\.")}$`, "i").test(email)) return fallback;
  const name = String(input.fromName || "Field Lynk").replace(/[<>"]/g, "").trim().slice(0, 80) || "Field Lynk";
  return `${name} <${email}>`;
}

export interface MailAttachment { filename: string; content: string; content_id?: string }

/** Inline pictures plus at most three PDF files. Other file types are dropped. */
export function mergeEmailAttachments(inline: MailAttachment[], files: unknown): MailAttachment[] {
  const out = [...inline];
  if (!Array.isArray(files)) return out;
  for (const file of files.slice(0, 3)) {
    if (!file || typeof file !== "object") continue;
    const rawName = String((file as { filename?: unknown }).filename || "");
    const filename = rawName.replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    const content = (file as { content?: unknown }).content;
    if (!filename.toLowerCase().endsWith(".pdf")) continue;
    if (typeof content !== "string" || !content || content.length > 12_000_000) continue;
    out.push({ filename, content });
  }
  return out;
}

/**
 * Shared client-email layout: LATEST APPROVED design (V8 client docs / estimate email, Johan 22 Oct 2026,
 * re-confirmed 30 Oct 20:47). Quote, deposit-invoice and final-invoice emails all render through this.
 * RULE: every client email follows the latest approved version of this layout. When Johan approves a new
 * design, change it HERE (both copies) and every email follows.
 * Exact copy in supabase/functions/_shared/brandedEmail.ts; keep the two identical (a test checks this).
 * No imports: runs in Vite and Deno.
 */
export const EMAIL_BRAND = {
  blue: "#0B4FA8", // V8 brand blue (app + estimate PDF)
  sky: "#1AA7EC", // V8 header gradient end
  orange: "#F7941D", // V8 action orange
  ink: "#1d2a3a", muted: "#6b7a8c", faint: "#9aa7b5", line: "#e3eaf2", page: "#eef3f9", foot: "#f2f9fe",
  /** Public absolute https base; images are also embedded as CID when sent so Gmail always shows them. */
  imageBase: "https://field-link-sync.lovable.app/email",
};

export interface EmailBrand {
  name: string;
  logoUrl?: string | null;
  /** true = transparent logo straight on the blue header (Massair CT); false = logo in a white box. */
  logoOnColour?: boolean;
  /** Short company line at the very top (name · VAT · Tel · email). */
  topParts?: string[];
}

export interface BrandedEmailOptions {
  brand: EmailBrand;
  title: string;
  kicker: string;
  greetingName?: string | null;
  bodyHtml: string;
  signatureHtml?: string;
  footerHtml?: string;
}

export const escEmail = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const emailFirstName = (n?: string | null) => { const t = String(n || "").trim(); if (!t) return ""; return /\b(pty|ltd|cc|inc|trust|construction|estates?)\b/i.test(t) ? t : t.split(/\s+/)[0]; };

/** Massair CT's approved logo is the white transparent one on the blue header. */
export const massairLogoUrl = (base: string = EMAIL_BRAND.imageBase) => `${base}/logo-white.png`;

export function brandedTopStrip(brand: EmailBrand): string {
  const parts = (brand.topParts || []).filter(Boolean).map(escEmail);
  if (!parts.length) return "";
  return `<tr><td style="padding:12px 28px 10px;background:#ffffff;"><div style="font-size:10px;color:${EMAIL_BRAND.muted};">${parts.join(" &middot; ")}</div></td></tr>`;
}

export function brandedHeader(brand: EmailBrand, kicker: string): string {
  const company = escEmail(brand.name || "Your installer");
  const logo = brand.logoUrl && brand.logoOnColour
    ? `<img src="${escEmail(brand.logoUrl)}" alt="${company}" width="200" style="display:block;width:200px;max-width:200px;height:auto;border:0;margin-bottom:10px;">`
    : brand.logoUrl ? `<div style="background:#ffffff;border-radius:8px;display:inline-block;padding:6px 10px;margin-bottom:10px;"><img src="${escEmail(brand.logoUrl)}" alt="${company}" width="180" style="display:block;width:180px;max-width:180px;height:auto;border:0;"></div>` : "";
  return `<tr><td style="background:${EMAIL_BRAND.blue};background-image:linear-gradient(90deg,${EMAIL_BRAND.blue},${EMAIL_BRAND.sky});padding:22px 28px;color:#ffffff;">
    ${logo}
    <div style="font-size:20px;font-weight:800;">${company}</div>
    <div style="font-size:12px;opacity:.9;">${escEmail(kicker)}</div>
  </td></tr>`;
}

/** Orange call-to-action button + copy-link fallback, as on the quote email. */
export function brandedButton(url: string, label: string, note = ""): string {
  return `<div style="text-align:center;margin:22px 0 8px;"><a href="${escEmail(url)}" style="display:inline-block;background:${EMAIL_BRAND.orange};color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;padding:16px 56px;border-radius:8px;">${label}</a></div>
    ${note ? `<div style="text-align:center;font-size:12px;color:${EMAIL_BRAND.muted};">${note}</div>` : ""}
    <div style="text-align:center;font-size:11px;color:${EMAIL_BRAND.faint};margin-top:8px;word-break:break-all;">If the button does not work, copy this link: ${escEmail(url)}</div>`;
}

/** Key/value table with the orange-ruled blue total row, as on the quote email. */
export function brandedSummaryTable(rows: Array<[string, string]>, total: [string, string]): string {
  const row = (k: string, v: string, top: boolean) => `<tr><td style="padding:10px 14px;color:${EMAIL_BRAND.muted};${top ? `border-top:1px solid ${EMAIL_BRAND.line};` : ""}">${k}</td><td style="padding:10px 14px;text-align:right;${top ? `border-top:1px solid ${EMAIL_BRAND.line};` : ""}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid ${EMAIL_BRAND.line};border-radius:8px;border-collapse:separate;font-size:13px;">
      ${rows.map(([k, v], i) => row(k, v, i > 0)).join("")}
      <tr><td style="padding:12px 14px;font-weight:800;color:${EMAIL_BRAND.blue};border-top:3px solid ${EMAIL_BRAND.orange};">${total[0]}</td><td style="padding:12px 14px;text-align:right;font-weight:800;color:${EMAIL_BRAND.blue};font-size:18px;border-top:3px solid ${EMAIL_BRAND.orange};">${total[1]}</td></tr>
    </table>`;
}

export function renderBrandedEmail(o: BrandedEmailOptions): string {
  const hi = emailFirstName(o.greetingName);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escEmail(o.title)}</title></head>
<body style="margin:0;padding:0;background-color:${EMAIL_BRAND.page};font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_BRAND.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
  ${brandedTopStrip(o.brand)}
  ${brandedHeader(o.brand, o.kicker)}
  <tr><td style="padding:24px 28px;color:${EMAIL_BRAND.ink};font-size:14px;line-height:1.5;">
    ${hi ? `Hi ${escEmail(hi)},` : "Hello,"}<br><br>
    ${o.bodyHtml}
    ${o.signatureHtml ? `<div style="margin-top:18px;border-top:1px solid ${EMAIL_BRAND.line};padding-top:16px;">${o.signatureHtml}</div>` : ""}
  </td></tr>
  ${o.footerHtml ? `<tr><td style="background:${EMAIL_BRAND.foot};padding:12px 28px;font-size:10px;color:${EMAIL_BRAND.faint};line-height:1.5;">${o.footerHtml}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

/** Final invoice body (Johan 30 Oct 20:29): balance after payments, View & pay, company + bank details, terms. */
export interface FinalInvoiceEmailData {
  invoiceNumber: string; dueDate?: string | null; total: string; paid: string; balance: string;
  link?: string | null; companyLines?: string[]; termsHtml?: string | null;
}
/** Standard confidentiality footer used on transactional (non-marketing) client emails. */
export function brandedTransactionalFooter(companyName: string, year = new Date().getFullYear()): string {
  return `This email and any attachments are confidential and intended solely for the addressee. Amounts are in South African Rand (ZAR) and include VAT at 15% where indicated. E&amp;OE. © ${year} ${escEmail(companyName)}.`;
}
export function finalInvoiceBodyHtml(d: FinalInvoiceEmailData): string {
  const lines = (d.companyLines || []).filter(Boolean).map(escEmail).join("<br>");
  return `Thank you, the work is done. Here is your final invoice for the balance. Use the button below to view and pay it.
    ${brandedSummaryTable([["Invoice", `<b>${escEmail(d.invoiceNumber)}</b>`], ...(d.dueDate ? [["Due", escEmail(d.dueDate)] as [string, string]] : []), ["Invoice total", escEmail(d.total)], ["Already paid", escEmail(d.paid)]], ["Balance due incl. VAT", escEmail(d.balance)])}
    ${d.link ? brandedButton(d.link, "View &amp; pay invoice") : ""}
    ${lines ? `<p style="margin:18px 0 8px;font-size:12px;color:${EMAIL_BRAND.muted};">${lines}</p>` : ""}
    ${d.termsHtml ? `<p style="margin:0 0 8px;font-size:11px;color:${EMAIL_BRAND.muted};"><b>Terms</b><br>${d.termsHtml}</p>` : ""}`;
}

/** Payment reminder body (Johan 31 Oct 09:58): the admin's reminder text + the same invoice summary and pay button. */
export interface PaymentReminderEmailData extends FinalInvoiceEmailData { message: string }
export function reminderMessageCore(msg: string): string {
  return String(msg || "").replace(/^\s*(hi|hello|dear)\b[^\n]*\n+/i, "").replace(/\n+\s*(kind regards|regards|thank you),?[\s\S]*$/i, "").trim();
}
export function paymentReminderBodyHtml(d: PaymentReminderEmailData): string {
  const paras = reminderMessageCore(d.message).split(/\n{2,}/).filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;">${escEmail(p).replace(/\n/g, "<br>")}</p>`).join("");
  const lines = (d.companyLines || []).filter(Boolean).map(escEmail).join("<br>");
  return `${paras}
    ${brandedSummaryTable([["Invoice", `<b>${escEmail(d.invoiceNumber)}</b>`], ...(d.dueDate ? [["Due", escEmail(d.dueDate)] as [string, string]] : []), ["Invoice total", escEmail(d.total)], ["Already paid", escEmail(d.paid)]], ["Balance due incl. VAT", escEmail(d.balance)])}
    ${d.link ? brandedButton(d.link, "View &amp; pay invoice") : ""}
    ${lines ? `<p style="margin:18px 0 8px;font-size:12px;color:${EMAIL_BRAND.muted};">${lines}</p>` : ""}`;
}

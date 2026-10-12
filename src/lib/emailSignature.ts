/**
 * Email signature (Mac design by Johan's Digital Artist, 12 Oct 2026).
 * ONE renderer used by the app preview and (as an exact copy in supabase/functions/_shared/emailSignature.ts)
 * by the email functions. Keep the two files identical (a test checks this). No imports: runs in Vite and Deno.
 * Company block is always MASSAIR CT (Johan: never Massair Ind CC in signatures), VAT exactly as on documents.
 */
export interface SignaturePerson {
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
}

export const SIGNATURE_IMAGE_BASE = "https://field-link-sync.lovable.app/email";

export const SIGNATURE_COMPANY = {
  brand: "0800-BE-COOL! AC Super Service",
  legalName: "Massair CT (Pty) Ltd",
  tel: "(021) 802-2889",
  telHref: "+27218022889",
  whatsapp: "069 683 8624",
  vatNo: "4630313080",
  email: "info@0800becool.co.za",
  web: "www.0800becool.co.za",
  address: "9A Cabernet Rd, Blackheath Ind, Cape Town 7580",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const C = "color:#0b4fa8";
const line = (html: string, extra = "") => `<div style="font-size:13px;${C};${extra}">${html}</div>`;
const link = (href: string, text: string) => `<a href="${esc(href)}" style="${C};text-decoration:none">${esc(text)}</a>`;
const digits = (p: string) => p.replace(/[^0-9+]/g, "").replace(/^0/, "+27");

/** Mac design. person = the sender (or the quote's salesperson); omitted = company only (automatic emails). */
export function renderSignatureHtml(person?: SignaturePerson | null, imageBase: string = SIGNATURE_IMAGE_BASE): string {
  const co = SIGNATURE_COMPANY;
  const p = person && person.name && person.name.trim() ? person : null;
  const rows: string[] = [];
  rows.push(`<div style="font-size:18px;font-weight:bold;${C}">${esc(p ? p.name.trim() : co.brand)}</div>`);
  if (p?.title && p.title.trim()) rows.push(line(esc(p.title.trim())));
  rows.push(line(esc(co.legalName), "font-weight:bold"));
  const phone = p?.phone && p.phone.trim() ? p.phone.trim() : null;
  rows.push(line(`Tel: ${link(`tel:${co.telHref}`, co.tel)} &nbsp;|&nbsp; ${phone
    ? `Cell: ${link(`tel:${digits(phone)}`, phone)}`
    : `WhatsApp/Cell: ${link(`https://wa.me/${digits(co.whatsapp).replace("+", "")}`, co.whatsapp)}`}`));
  const mail = p?.email && p.email.trim() ? p.email.trim() : null;
  rows.push(line(mail && mail.toLowerCase() !== co.email ? `${link(`mailto:${mail}`, mail)} &nbsp;|&nbsp; ${link(`mailto:${co.email}`, co.email)}` : link(`mailto:${co.email}`, co.email)));
  rows.push(line(`${link(`https://${co.web}`, co.web)} &nbsp;|&nbsp; VAT No ${esc(co.vatNo)}`));
  rows.push(line(esc(co.address)));
  return `<table cellpadding="0" cellspacing="0" role="presentation" data-email-signature style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:18px 0"><tr>`
    + `<td style="padding-right:22px;border-right:3px solid #1aa7ec;vertical-align:middle"><img src="${imageBase}/logo-block-shadow.png" width="224" alt="0800-BE-COOL! AC Super Service" style="display:block;border:0"></td>`
    + `<td style="padding-left:22px;line-height:1.5;white-space:nowrap;vertical-align:middle">${rows.join("")}</td>`
    + `<td style="padding-left:18px;vertical-align:middle"><img src="${imageBase}/units-pair5.png" width="270" alt="Air conditioners" style="display:block;border:0"></td>`
    + `</tr></table>`;
}

/**
 * Automatic reminders: the quote's salesperson AND the company block ("double signature").
 * With no salesperson it is the company block only.
 */
export function renderReminderSignatureHtml(salesperson?: SignaturePerson | null, imageBase: string = SIGNATURE_IMAGE_BASE): string {
  if (!salesperson || !salesperson.name?.trim()) return renderSignatureHtml(null, imageBase);
  return renderSignatureHtml(salesperson, imageBase)
    + `<div style="height:1px;background:#e5e7eb;margin:4px 0"></div>`
    + renderSignatureHtml(null, imageBase);
}

export function renderSignatureText(person?: SignaturePerson | null): string {
  const co = SIGNATURE_COMPANY;
  const p = person && person.name && person.name.trim() ? person : null;
  return [
    p ? p.name.trim() : co.brand,
    p?.title?.trim() || null,
    co.legalName,
    `Tel: ${co.tel} | ${p?.phone?.trim() ? `Cell: ${p.phone.trim()}` : `WhatsApp/Cell: ${co.whatsapp}`}`,
    [p?.email?.trim(), co.email].filter(Boolean).join(" | "),
    `${co.web} | VAT No ${co.vatNo}`,
    co.address,
  ].filter(Boolean).join("\n");
}

/** Role label when a person has no title of their own. */
export function defaultTitleForRole(role?: string | null): string | null {
  switch ((role || "").toLowerCase()) {
    case "admin": return "Director";
    case "sales_rep": case "sales": return "Sales Consultant";
    case "dispatcher": return "Office";
    case "field_agent": case "technician": return "Technician";
    default: return null;
  }
}

/**
 * Email signature (Mac design by Johan's Digital Artist, 12 Oct 2026).
 * ONE renderer used by the app preview and (as an exact copy in supabase/functions/_shared/emailSignature.ts)
 * by the email functions. Keep the two files identical (a test checks this). No imports: runs in Vite and Deno.
 * Company block = the SENDING company's own record (signatureCompanyFromProfile); Massair CT keeps the exact design.
 * No company passed = the Massair CT design (legacy default).
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

/** The sending company's block. Built from that company's own Field Lynk record (company_profiles). */
export interface SignatureCompany {
  brand: string; legalName: string; tel: string | null; telHref?: string | null; whatsapp: string | null;
  vatNo: string | null; email: string | null; web: string | null; address: string | null;
  /** Logo image url; null = use the designed block when the company is Massair CT, else the name as text. */
  logoUrl?: string | null;
}

/** Massair CT keeps the Digital Artist design exactly (logo block + fixed layout). */
export const isDesignedCompany = (co: SignatureCompany) => /^massair ct\b/i.test((co.legalName || "").trim());

// deno-lint-ignore no-explicit-any
export function signatureCompanyFromProfile(prof: any): SignatureCompany | null {
  if (!prof || !(prof.legal_name || prof.trading_name)) return null;
  const legal = String(prof.legal_name || prof.trading_name).trim().replace(/^MASSAIR CT \(PTY\) LTD$/i, "Massair CT (Pty) Ltd");
  const designed = /^massair ct\b/i.test(legal);
  const addr = Array.isArray(prof.address_lines) ? prof.address_lines.filter(Boolean).join(", ") : (prof.address_lines || null);
  return {
    // Never "t/a": the brand line is the designed one for Massair, else the company's own trading name.
    brand: designed ? SIGNATURE_COMPANY.brand : String(prof.trading_name || legal).replace(/\bt\/a\b.*$/i, "").trim(),
    legalName: legal,
    tel: designed ? SIGNATURE_COMPANY.tel : (prof.phone || null),
    telHref: designed ? SIGNATURE_COMPANY.telHref : null,
    whatsapp: prof.whatsapp || (designed ? SIGNATURE_COMPANY.whatsapp : null),
    vatNo: prof.vat_number || null,
    email: prof.email || null,
    web: prof.website || null,
    address: designed ? SIGNATURE_COMPANY.address : addr,
    logoUrl: prof.logo_url || null,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const C = "color:#0b4fa8";
const line = (html: string, extra = "") => `<div style="font-size:13px;${C};${extra}">${html}</div>`;
const link = (href: string, text: string) => `<a href="${esc(href)}" style="${C};text-decoration:none">${esc(text)}</a>`;
const digits = (p: string) => p.replace(/[^0-9+]/g, "").replace(/^0/, "+27");

/** Mac design. person = the sender (or the quote's salesperson); omitted = company only (automatic emails). */
export function renderSignatureHtml(person?: SignaturePerson | null, imageBase: string = SIGNATURE_IMAGE_BASE, company?: SignatureCompany | null): string {
  const co: SignatureCompany = company || SIGNATURE_COMPANY;
  const p = person && person.name && person.name.trim() ? person : null;
  const rows: string[] = [];
  rows.push(`<div style="font-size:18px;font-weight:bold;${C}">${esc(p ? p.name.trim() : co.brand)}</div>`);
  if (p?.title && p.title.trim()) rows.push(line(esc(p.title.trim())));
  rows.push(line(esc(co.legalName), "font-weight:bold"));
  const phone = p?.phone && p.phone.trim() ? p.phone.trim() : null;
  const tel = co.tel ? `Tel: ${link(`tel:${co.telHref || digits(co.tel)}`, co.tel)}` : "";
  const cell = phone
    ? `Cell: ${link(`tel:${digits(phone)}`, phone)}`
    : co.whatsapp ? `WhatsApp/Cell: ${link(`https://wa.me/${digits(co.whatsapp).replace("+", "")}`, co.whatsapp)}` : "";
  if (tel || cell) rows.push(line([tel, cell].filter(Boolean).join(" &nbsp;|&nbsp; ")));
  const mail = p?.email && p.email.trim() ? p.email.trim() : null;
  const coMail = co.email || "";
  const mails = [mail && mail.toLowerCase() !== coMail.toLowerCase() ? link(`mailto:${mail}`, mail) : "", coMail ? link(`mailto:${coMail}`, coMail) : ""].filter(Boolean);
  if (mails.length) rows.push(line(mails.join(" &nbsp;|&nbsp; ")));
  const webVat = [co.web ? link(`https://${co.web.replace(/^https?:\/\//, "")}`, co.web) : "", co.vatNo ? `VAT No ${esc(co.vatNo)}` : ""].filter(Boolean);
  if (webVat.length) rows.push(line(webVat.join(" &nbsp;|&nbsp; ")));
  if (co.address) rows.push(line(esc(co.address)));
  const logoCell = co.logoUrl
    ? `<img src="${esc(co.logoUrl)}" width="224" alt="${esc(co.brand)}" style="display:block;border:0;max-width:224px;height:auto">`
    : isDesignedCompany(co)
      ? `<img src="${imageBase}/logo-block-shadow.png" width="224" alt="${esc(co.brand)}" style="display:block;border:0">`
      : `<div style="font-size:20px;font-weight:800;${C};max-width:224px">${esc(co.brand)}</div>`;
  return `<table cellpadding="0" cellspacing="0" role="presentation" data-email-signature style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:18px 0"><tr>`
    + `<td style="padding-right:22px;border-right:3px solid #1aa7ec;vertical-align:middle">${logoCell}</td>`
    + `<td style="padding-left:22px;line-height:1.5;white-space:nowrap;vertical-align:middle">${rows.join("")}</td>`
    + `<td style="padding-left:18px;vertical-align:middle"><img src="${imageBase}/units-pair5.png" width="270" alt="Air conditioners" style="display:block;border:0"></td>`
    + `</tr></table>`;
}

/**
 * Automatic reminders: the quote's salesperson AND the company block ("double signature").
 * With no salesperson it is the company block only.
 */
export function renderReminderSignatureHtml(salesperson?: SignaturePerson | null, imageBase: string = SIGNATURE_IMAGE_BASE, company?: SignatureCompany | null): string {
  if (!salesperson || !salesperson.name?.trim()) return renderSignatureHtml(null, imageBase, company);
  return renderSignatureHtml(salesperson, imageBase, company)
    + `<div style="height:1px;background:#e5e7eb;margin:4px 0"></div>`
    + renderSignatureHtml(null, imageBase, company);
}

export function renderSignatureText(person?: SignaturePerson | null, company?: SignatureCompany | null): string {
  const co: SignatureCompany = company || SIGNATURE_COMPANY;
  const p = person && person.name && person.name.trim() ? person : null;
  const cell = p?.phone?.trim() ? `Cell: ${p.phone.trim()}` : co.whatsapp ? `WhatsApp/Cell: ${co.whatsapp}` : "";
  return [
    p ? p.name.trim() : co.brand,
    p?.title?.trim() || null,
    co.legalName,
    [co.tel ? `Tel: ${co.tel}` : "", cell].filter(Boolean).join(" | ") || null,
    [p?.email?.trim(), co.email].filter(Boolean).join(" | ") || null,
    [co.web, co.vatNo ? `VAT No ${co.vatNo}` : ""].filter(Boolean).join(" | ") || null,
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

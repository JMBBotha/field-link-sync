/** Client "order paid" email for online shop orders (2026-10-19). Plain, branded by send-transactional-email's company signature. */
import { SHOP_CONTACT } from "./shopTerms.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const rand = (n: number) => {
  const [whole, cents] = Math.abs(Number(n || 0)).toFixed(2).split(".");
  return "R " + whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + cents;
};

export const QUOTE_LINK_BASE = "https://field-link-sync.lovable.app/quote/";

// deno-lint-ignore no-explicit-any
export function shopPaidEmail(fin: any): { subject: string; html: string } {
  const lines = Array.isArray(fin?.lines) ? fin.lines : [];
  const rows = lines.map((l: any) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(l.label)} (${esc(l.size)}): ${esc(l.unit?.name ?? "Air conditioner")}, standard installation${l.isolator ? ", isolator point" : ""}</td>` +
    `<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${rand(l.room_incl)}</td></tr>`
  ).join("");
  const first = esc(fin?.first_name || fin?.name || "there");
  const link = fin?.quote_token ? `${QUOTE_LINK_BASE}${encodeURIComponent(fin.quote_token)}` : null;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;background:#fff">` +
    `<div style="max-width:600px;margin:0 auto;padding:16px">` +
    `<p>Hi ${first},</p>` +
    `<p>Thank you, we've received your payment of <strong>${rand(fin?.total_incl)}</strong> for order <strong>${esc(fin?.order_ref)}</strong>. It's paid in full.</p>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}` +
    `<tr><td style="padding:8px 0"><strong>Total paid (incl. VAT)</strong></td><td style="padding:8px 0;text-align:right"><strong>${rand(fin?.total_incl)}</strong></td></tr></table>` +
    `<p><strong>What happens next:</strong> we'll contact you to book your installation date. Your time isn't booked until we confirm it with you.</p>` +
    `<p>On the day, before any work starts, our technician checks the site with you. If anything is different from your order, we'll give you an updated quotation first and won't do or charge for extra work unless you approve it. If you don't accept the updated quotation, you can cancel and we'll refund your payment in full.</p>` +
    (link ? `<p>Your quote, invoice ${esc(fin?.invoice_number)} and terms: <a href="${link}">${link}</a></p>` : "") +
    `<p>Questions? WhatsApp Sam on ${esc(SHOP_CONTACT.sam_whatsapp)} or call ${esc(SHOP_CONTACT.phone)}.</p>` +
    `</div></body></html>`;
  return { subject: `Payment received, order ${fin?.order_ref ?? ""}`.trim(), html };
}

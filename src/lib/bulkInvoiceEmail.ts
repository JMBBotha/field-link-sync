import { sameClientCheck } from "@/lib/agreementTemplates/contracts";
import { escEmail, renderBrandedEmail, brandedTransactionalFooter } from "@/lib/brandedEmail";
import { safeFilePart } from "@/lib/bulkQuotePdf";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import { formatRand } from "@/utils/formatRand";
import { PUBLISHED_APP_ORIGIN } from "@/lib/publicAppUrl";

/** Most invoices one email will carry. Each one is a full client PDF inside the combined file. */
export const BULK_INVOICE_EMAIL_CAP = 20;

export interface BulkInvoiceLine {
  line_type?: string | null;
  unit_price?: number | string | null;
  rate?: number | string | null;
  quantity?: number | string | null;
  description?: string | null;
}

export interface BulkInvoiceRow {
  id: string;
  invoice_number: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  status?: string | null;
  grand_total?: number | string | null;
  /** Balance still owing. Falls back to the invoice total when the list has not worked it out. */
  amount_due?: number | null;
  lines?: BulkInvoiceLine[] | null;
}

export interface InvoiceEmailExclusion {
  id: string;
  invoice_number: string;
  reason: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Void, cancelled, and a draft whose total or a line is R0. Priced drafts can be emailed. */
export function invoiceEmailBlock(row: BulkInvoiceRow): string | null {
  const status = (row.status || "").toLowerCase();
  const num = row.invoice_number || "Invoice";
  if (status === "void" || status === "cancelled") return `${num} is ${status} and was left out.`;
  if (status !== "draft") return null;
  const total = Number(row.grand_total) || 0;
  const r0Line = (row.lines || []).some((line) => {
    if ((line.line_type || "") === "deposit") return false;
    const qty = line.quantity == null || line.quantity === "" ? 1 : Number(line.quantity);
    if (!Number.isFinite(qty) || qty === 0) return false;
    const price = Number(line.unit_price ?? line.rate);
    return !Number.isFinite(price) || price <= 0;
  });
  if (total <= 0 || r0Line) return `${num} is a draft with R0. Enter a price before sending it.`;
  return null;
}

export function partitionBulkInvoices(rows: BulkInvoiceRow[]): { included: BulkInvoiceRow[]; excluded: InvoiceEmailExclusion[] } {
  const excluded: InvoiceEmailExclusion[] = [];
  const included: BulkInvoiceRow[] = [];
  for (const row of rows) {
    const reason = invoiceEmailBlock(row);
    if (reason) excluded.push({ id: row.id, invoice_number: row.invoice_number, reason });
    else included.push(row);
  }
  return { included, excluded };
}

/**
 * Email is allowed when every ticked invoice that has a client is that same client,
 * and at least two of them can actually be sent. Void and R0 drafts are reported
 * separately and do not count toward the two.
 */
export function bulkInvoiceEmailGate(rows: BulkInvoiceRow[]): {
  ok: boolean;
  reason: string | null;
  included: BulkInvoiceRow[];
  excluded: InvoiceEmailExclusion[];
  customerId: string | null;
} {
  const { included, excluded } = partitionBulkInvoices(rows);
  const linked = rows.filter((row) => row.customer_id);
  const same = sameClientCheck(linked.map((row) => ({ id: row.id, customer_id: row.customer_id ?? null, label: row.invoice_number })));
  if (!same.ok) {
    return { ok: false, reason: same.reason, included, excluded, customerId: null };
  }
  if (rows.length > BULK_INVOICE_EMAIL_CAP) {
    return { ok: false, reason: `Choose ${BULK_INVOICE_EMAIL_CAP} or fewer invoices.`, included, excluded, customerId: same.customerId };
  }
  if (included.length < 2) {
    const extra = excluded.map((e) => e.reason).join(" ");
    const reason = extra
      ? `${extra} Select at least two invoices for the same client.`
      : "Select at least two invoices for the same client.";
    return { ok: false, reason, included, excluded, customerId: same.customerId };
  }
  return { ok: true, reason: excluded.length ? excluded.map((e) => e.reason).join(" ") : null, included, excluded, customerId: same.customerId };
}

export function bulkInvoiceSubject(numbers: string[], company: string): string {
  const list = numbers.map((n) => n.trim()).filter(Boolean).join(", ");
  const name = company.replace(/\s+/g, " ").trim() || "us";
  return `Invoices ${list} from ${name}`;
}

export function invoiceClientLink(invoiceId: string, token?: string | null): string {
  const tok = (token || "").trim() || "…";
  return `${PUBLISHED_APP_ORIGIN}/customer/${tok}/invoice/${invoiceId}`;
}

export function combinedInvoicePdfName(customerName: string | null | undefined, now = new Date()): string {
  const date = todayInJohannesburg(now);
  const customer = safeFilePart(customerName || "");
  return customer ? `Invoices-${customer}-${date}.pdf` : `Invoices-${date}.pdf`;
}

export function bulkInvoiceBodyHtml(rows: Array<{ invoice_number: string; amount: number; amount_due: number; link: string }>, company: string): string {
  const name = company.replace(/\s+/g, " ").trim() || "us";
  const items = rows.map((row) => {
    const num = escEmail(row.invoice_number);
    return `<p style="margin:0 0 14px;"><strong>${num}</strong><br>Amount ${escEmail(formatRand(row.amount))}<br>Amount due ${escEmail(formatRand(row.amount_due))}<br><a href="${escEmail(row.link)}">Open ${num}</a></p>`;
  }).join("");
  return `<p style="margin:0 0 14px;">Here ${rows.length === 1 ? "is" : "are"} ${rows.length} invoice${rows.length === 1 ? "" : "s"} from ${escEmail(name)}.</p>${items}<p style="margin:0;">Pay by EFT and use the invoice number as your reference. The invoices are attached as one PDF.</p>`;
}

/** Local preview used before the server reply, and by the demo harness. No email is sent. */
export function bulkInvoicePreview(rows: BulkInvoiceRow[], company: string, token?: string | null) {
  const subject = bulkInvoiceSubject(rows.map((row) => row.invoice_number), company);
  const bodyHtml = bulkInvoiceBodyHtml(rows.map((row) => ({
    invoice_number: row.invoice_number,
    amount: Number(row.grand_total) || 0,
    amount_due: row.amount_due == null ? Number(row.grand_total) || 0 : Number(row.amount_due) || 0,
    link: invoiceClientLink(row.id, token),
  })), company);
  const html = renderBrandedEmail({
    brand: { name: company || "Field Lynk" },
    title: subject,
    kicker: "Your invoices",
    greetingName: rows[0]?.customer_name,
    bodyHtml,
    footerHtml: brandedTransactionalFooter(company || "Field Lynk"),
  });
  const to = (rows.find((row) => row.customer_email)?.customer_email || "").trim();
  return { to, subject, html };
}

export function validRecipient(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** One attachment, shared by every invoice in the email. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = await blobBytes(blob);
  let bin = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    bin += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(bin);
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error("Could not read the PDF"));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

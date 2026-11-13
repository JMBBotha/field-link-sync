import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";
import { HOUSE_EMBED, invoiceHouseLabel } from "@/lib/invoiceHouse";
import { documentProfile, fetchCompanyProfiles, profileTermsInfo, type CompanyProfile } from "@/lib/companyProfiles";
import { creditedByInvoice, fetchCreditNotes } from "@/lib/creditNotes";
import { invoiceStamps, type StampPayment } from "@/lib/invoiceStamps";
import { sumSettled } from "@/lib/payments";
import { generateDocumentPdfBlob } from "@/lib/documentPdf";

/**
 * Off-screen Field Lynk invoice, the same document the invoice page prints.
 * Used only to build the PDF that a combined invoice email attaches.
 */
export const invoicePdfSelector = (invoiceId: string) =>
  `[data-invoice-pdf-root="${invoiceId}"][data-ready="true"] [data-pdf-capture-root="invoice"]`;

export async function waitForInvoicePdfRoot(invoiceId: string, timeoutMs = 12000): Promise<string> {
  const started = Date.now();
  const selector = invoicePdfSelector(invoiceId);
  for (;;) {
    const wrapper = document.querySelector(`[data-invoice-pdf-root="${invoiceId}"]`);
    const err = wrapper?.getAttribute("data-error");
    if (err) throw new Error(err);
    const el = document.querySelector(selector);
    if (el) {
      const imgs = Array.from(el.querySelectorAll("img"));
      await Promise.race([
        Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
      return selector;
    }
    if (Date.now() - started > timeoutMs) throw new Error("Invoice PDF did not load in time. Try again.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The caller must already have mounted InvoicePdfRoot for this invoice. */
export async function renderInvoicePdfBlob(invoiceId: string): Promise<Blob> {
  const captureSelector = await waitForInvoicePdfRoot(invoiceId);
  const { data, error } = await supabase.from("invoices").select("invoice_number, customer_name, customer_address, customer_email, issue_date, created_at, due_date, notes, subtotal, tax_rate, tax_amount, grand_total").eq("id", invoiceId).maybeSingle();
  if (error || !data) throw error || new Error("Invoice not found");
  return generateDocumentPdfBlob({
    docType: "Invoice",
    docNumber: data.invoice_number,
    companyName: "",
    customerName: data.customer_name,
    customerAddress: data.customer_address || undefined,
    customerEmail: data.customer_email || undefined,
    issueDate: data.issue_date || data.created_at,
    dueDate: data.due_date || undefined,
    lineItems: [],
    subtotal: Number(data.subtotal) || 0,
    taxRate: Number(data.tax_rate) || 15,
    taxAmount: Number(data.tax_amount) || 0,
    total: Number(data.grand_total) || 0,
    notes: data.notes || undefined,
    captureSelector,
  });
}

type Loaded = {
  invoice: any;
  items: Array<{ description: string; quantity: number; unit_price: number; amount: number; line_name?: string | null; room_label?: string | null }>;
  paid: number;
  credited: number;
  stamps: ReturnType<typeof invoiceStamps>;
  profile: CompanyProfile | null;
};

export default function InvoicePdfRoot({ invoiceId }: { invoiceId: string }) {
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    (async () => {
      const [invoiceRes, itemsRes, payRes, profiles, credits] = await Promise.all([
        supabase.from("invoices").select(`*, ${HOUSE_EMBED}`).eq("id", invoiceId).maybeSingle(),
        supabase.from("invoice_items").select("description, quantity, unit_price, amount, line_name, room_label, sort_order").eq("invoice_id", invoiceId).order("sort_order", { ascending: true }),
        supabase.from("payments").select("amount, status, gateway, payment_date, created_at").eq("invoice_id", invoiceId),
        fetchCompanyProfiles(),
        fetchCreditNotes([invoiceId]).catch(() => []),
      ]);
      if (cancelled) return;
      if (invoiceRes.error || !invoiceRes.data) {
        setError(invoiceRes.error?.message || "Invoice not found");
        return;
      }
      const invoice = invoiceRes.data as any;
      const itemRows = (itemsRes.data || []) as any[];
      const items = itemRows.length
        ? itemRows.map((item) => ({ description: item.description, quantity: Number(item.quantity) || 0, unit_price: Number(item.unit_price) || 0, amount: Number(item.amount) || 0, line_name: item.line_name, room_label: item.room_label }))
        : ((invoice.line_items || []) as any[]).map((item) => ({ description: item.description || item.line_name || "Item", quantity: Number(item.quantity) || 0, unit_price: Number(item.unit_price ?? item.rate) || 0, amount: Number(item.amount) || 0, line_name: item.line_name, room_label: item.room_label }));
      const pays = (payRes.data || []) as StampPayment[];
      const credited = creditedByInvoice(credits).get(invoiceId) || 0;
      setDoc({
        invoice,
        items,
        paid: sumSettled(pays as any),
        credited,
        stamps: invoiceStamps(invoice, pays, credited),
        profile: documentProfile(invoice, profiles),
      });
    })().catch((err: { message?: string }) => { if (!cancelled) setError(err?.message || "Could not load the invoice"); });
    return () => { cancelled = true; };
  }, [invoiceId]);

  const invoice = doc?.invoice;
  return (
    <div
      data-invoice-pdf-root={invoiceId}
      data-ready={doc ? "true" : "false"}
      data-error={error || undefined}
      style={{ position: "fixed", top: 0, left: "-10000px", width: "820px", pointerEvents: "none" }}
      aria-hidden="true"
    >
      {doc && invoice && (
        <InvoiceDocument
          invoiceNumber={invoice.invoice_number}
          reference={invoiceHouseLabel(invoice, true)}
          status={invoice.status}
          issueDate={invoice.issue_date || invoice.created_at}
          dueDate={invoice.due_date}
          customerName={invoice.customer_name}
          customerAddress={invoice.customer_address}
          customerEmail={invoice.customer_email}
          customerPhone={invoice.customer_phone}
          items={doc.items}
          subtotal={Number(invoice.subtotal) || 0}
          taxRate={Number(invoice.tax_rate) || 15}
          taxAmount={Number(invoice.tax_amount) || 0}
          grandTotal={Number(invoice.grand_total) || 0}
          amountPaid={doc.paid}
          credited={doc.credited}
          notes={invoice.notes}
          profile={doc.profile}
          billedToVat={invoice.billed_to_vat_number}
          discountAmount={Number(invoice.discount_amount) || 0}
          depositAmount={Number(invoice.deposit_amount) || 0}
          stamps={doc.stamps}
          termsCompany={profileTermsInfo(doc.profile)}
          depositLabel={invoice.deposit_type === "percent" ? `${Number(invoice.deposit_value)}% of total incl. VAT` : null}
        />
      )}
    </div>
  );
}

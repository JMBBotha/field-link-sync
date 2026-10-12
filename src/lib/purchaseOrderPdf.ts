import jsPDF from "jspdf";
import { profileIdentity, type CompanyProfile } from "@/lib/companyProfiles";

export interface PoItem { model_code: string | null; description: string | null; qty: number; unit_cost_excl_vat: number; line_total_excl_vat: number }
export interface PoRow {
  id: string; po_number: string; status: string; created_at: string;
  client_name: string | null; job_reference: string | null; supplier_account_number: string | null;
  supplier_emails: string[]; deliver_to: string | null; subtotal: number; vat_amount: number; total: number;
  supplier?: { name: string | null; main_phone: string | null } | null;
  invoice_number?: string | null;
  items: PoItem[];
}

export const PO_DOCS_LINE = "Send invoices and delivery notes to: accounts@0800becool.co.za";
const R = (n: number) => "R " + (Number(n) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Supplier purchase order PDF. Company block comes from the company record (company_profiles). Costs are printed as stored. */
export function buildPurchaseOrderPdf(po: PoRow, profile: Partial<CompanyProfile> | null): jsPDF {
  const id = profileIdentity(profile);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 18;
  doc.setFont("helvetica", "bold").setFontSize(18).text("PURCHASE ORDER", 14, y);
  doc.setFontSize(10).text(po.po_number, 196, y, { align: "right" });
  y += 8;
  doc.setFont("helvetica", "normal").setFontSize(9);
  const left = [id.legalName, ...id.addressLines, id.tel ? `Tel ${id.tel}` : "", id.email || "", id.vatNo ? `VAT No ${id.vatNo}` : ""].filter(Boolean);
  left.forEach((l, i) => doc.text(l, 14, y + i * 4.5));
  const right = [
    `Date: ${new Date(po.created_at).toLocaleDateString("en-ZA")}`,
    `Status: ${po.status.toUpperCase()}`,
    po.supplier_account_number ? `Our account no: ${po.supplier_account_number}` : "",
    po.invoice_number ? `Our invoice: ${po.invoice_number}` : "",
  ].filter(Boolean);
  right.forEach((l, i) => doc.text(l, 196, y + i * 4.5, { align: "right" }));
  y += Math.max(left.length, right.length) * 4.5 + 6;

  doc.setFont("helvetica", "bold").text("Supplier", 14, y); doc.text("Client / job", 110, y);
  doc.setFont("helvetica", "normal");
  const sup = [po.supplier?.name?.trim() || "", ...(po.supplier_emails || []), po.supplier?.main_phone || ""].filter(Boolean);
  sup.forEach((l, i) => doc.text(l, 14, y + 5 + i * 4.5));
  const cj = [po.client_name || "", po.job_reference ? doc.splitTextToSize(`Job: ${po.job_reference}`, 86) : ""].flat().filter(Boolean) as string[];
  cj.forEach((l, i) => doc.text(l, 110, y + 5 + i * 4.5));
  y += Math.max(sup.length, cj.length) * 4.5 + 9;
  if (po.deliver_to) { doc.setFont("helvetica", "bold").text("Deliver to: ", 14, y); doc.setFont("helvetica", "normal").text(po.deliver_to, 34, y); y += 7; }

  doc.setFillColor(240, 240, 240).rect(14, y - 4, 182, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.text("Model", 16, y); doc.text("Description", 52, y); doc.text("Qty", 138, y, { align: "right" });
  doc.text("Unit excl VAT", 166, y, { align: "right" }); doc.text("Total excl VAT", 194, y, { align: "right" });
  doc.setFont("helvetica", "normal"); y += 6;
  for (const it of po.items) {
    const d = doc.splitTextToSize(it.description || "", 80) as string[];
    doc.text(it.model_code || "", 16, y); doc.text(d, 52, y);
    doc.text(String(Number(it.qty)), 138, y, { align: "right" });
    doc.text(R(it.unit_cost_excl_vat), 166, y, { align: "right" }); doc.text(R(it.line_total_excl_vat), 194, y, { align: "right" });
    y += Math.max(1, d.length) * 4.5 + 2;
  }
  y += 3; doc.line(120, y - 3, 196, y - 3);
  ([["Subtotal excl VAT", po.subtotal], ["VAT 15%", po.vat_amount], ["Total incl VAT", po.total]] as const).forEach(([k, v], i) => {
    if (i === 2) doc.setFont("helvetica", "bold");
    doc.text(k, 150, y + i * 5, { align: "right" }); doc.text(R(v), 194, y + i * 5, { align: "right" });
  });
  y += 22;
  doc.setFont("helvetica", "bold").setFontSize(10).text(PO_DOCS_LINE, 14, y);
  doc.setFont("helvetica", "normal").setFontSize(8).text(`Please quote ${po.po_number} on all invoices and delivery notes.`, 14, y + 5);
  return doc;
}

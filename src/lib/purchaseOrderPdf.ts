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
/** Docs line for the issuing company: its own email; Massair keeps its accounts@ address. */
export const poDocsLine = (p?: Partial<CompanyProfile> | null) => {
  if (!p?.legal_name || /massair/i.test(p.legal_name)) return PO_DOCS_LINE;
  const email = profileIdentity(p).email;
  return email ? `Send invoices and delivery notes to: ${email}` : "Please send invoices and delivery notes with this PO number.";
};
const R = (n: number) => "R " + (Number(n) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const B1: [number, number, number] = [11, 79, 168];
const B2: [number, number, number] = [26, 167, 236];
const OR: [number, number, number] = [247, 148, 29];
const INK: [number, number, number] = [29, 42, 58];
const MUT: [number, number, number] = [107, 122, 140];

export interface PoPdfOptions {
  /** 'light' (default) | 'bold' — company_profiles.document_style. */
  style?: "light" | "bold";
  /** PNG data URL of the company logo (Light: colour logo, Bold: white logo). */
  logoDataUrl?: string | null;
  logoAspect?: number;
}

/**
 * Supplier purchase order PDF in the Light/Bold design (Johan 2026-10-13, brand-docs/Light + Bold PO-0001776-01).
 * Company block comes from the issuing company's record (company_profiles). Costs are printed as stored.
 */
export function buildPurchaseOrderPdf(po: PoRow, profile: Partial<CompanyProfile> | null, opts: PoPdfOptions = {}): jsPDF {
  const id = profileIdentity(profile);
  const bold = (opts.style ?? ((profile as any)?.document_style === "bold" ? "bold" : "light")) === "bold";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 14, RT = 196;
  const companyLines = [...id.addressLines, id.tel ? `Tel ${id.tel}` : "", id.email || "", id.vatNo ? `VAT ${id.vatNo}` : ""].filter(Boolean);
  const headH = Math.max(30, 10 + companyLines.length * 4);
  if (bold) { doc.setFillColor(...B2).rect(0, 0, 210, headH + 8, "F"); }
  let x = L;
  if (opts.logoDataUrl) {
    const h = bold ? 18 : 24; const w = h * (opts.logoAspect || 1.3);
    try { doc.addImage(opts.logoDataUrl, "PNG", L, 8, w, h); x = L + w + 5; } catch { /* no logo */ }
  }
  const head = bold ? [255, 255, 255] as [number, number, number] : B1;
  if (!bold) { doc.setDrawColor(...B2).setLineWidth(0.5).line(x, 9, x, 9 + headH - 12); x += 4; }
  doc.setTextColor(...head).setFont("helvetica", "bold").setFontSize(9.5).text(id.legalName, x, 12);
  doc.setFont("helvetica", "normal").setFontSize(7.6);
  companyLines.forEach((l, i) => doc.text(l, x, 16.5 + i * 3.7));
  doc.setFont("helvetica", "bold").setFontSize(19).setTextColor(...head).text("PURCHASE ORDER", RT, 16, { align: "right" });
  doc.setFontSize(10);
  if (bold) {
    const w = doc.getTextWidth(po.po_number) + 8;
    doc.setFillColor(...OR).roundedRect(RT - w, 20, w, 7, 1.5, 1.5, "F");
    doc.setTextColor(255, 255, 255).text(po.po_number, RT - 4, 25, { align: "right" });
  } else {
    doc.setTextColor(...OR).text(po.po_number, RT, 24, { align: "right" });
  }
  let y = headH + (bold ? 16 : 8);
  if (!bold) {
    doc.setDrawColor(...B2).setLineWidth(0.8).line(L, y - 4, L + 136, y - 4);
    doc.setDrawColor(...OR).line(L + 136, y - 4, RT, y - 4);
    y += 4;
  }

  const label = (t: string, xx: number, yy: number) => { doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...(bold ? B1 : B2)).text(t.toUpperCase(), xx, yy); };
  label("Supplier", L, y); label("Client / job", 82, y); label("Order", 150, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
  const sup = [po.supplier?.name?.trim() || "", ...(po.supplier_emails || []), po.supplier?.main_phone || ""].filter(Boolean);
  sup.forEach((l, i) => { if (i === 0) doc.setFont("helvetica", "bold"); else doc.setFont("helvetica", "normal"); doc.text(l, L, y + 5 + i * 4.5); });
  doc.setFont("helvetica", "normal");
  const cj = [po.client_name || "", ...(po.job_reference ? doc.splitTextToSize(`Job: ${po.job_reference}`, 62) as string[] : [])].filter(Boolean);
  cj.forEach((l, i) => doc.text(l, 82, y + 5 + i * 4.5));
  const meta: [string, string][] = [["Date", new Date(po.created_at).toLocaleDateString("en-ZA")], ["Status", po.status.toUpperCase()],
    ...(po.supplier_account_number ? [["Our acc no", po.supplier_account_number] as [string, string]] : []),
    ...(po.invoice_number ? [["Our invoice", po.invoice_number] as [string, string]] : [])];
  meta.forEach(([k, v], i) => { doc.setTextColor(...MUT).text(k, 150, y + 5 + i * 4.5); doc.setTextColor(...INK).setFont("helvetica", "bold").text(v, RT, y + 5 + i * 4.5, { align: "right" }); doc.setFont("helvetica", "normal"); });
  y += Math.max(sup.length, cj.length, meta.length) * 4.5 + 10;
  if (po.deliver_to) { label("Deliver to", L, y); doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK).text(doc.splitTextToSize(po.deliver_to, 150) as string[], L + 22, y); y += 8; }

  // Table header
  if (bold) { doc.setFillColor(...B1).rect(L, y - 4.5, RT - L, 7, "F"); doc.setTextColor(255, 255, 255); }
  else { doc.setTextColor(...B1); doc.setDrawColor(...B2).setLineWidth(0.6).line(L, y + 2.5, RT, y + 2.5); }
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  doc.text("QTY", L + 2, y); doc.text("CODE", L + 14, y); doc.text("DESCRIPTION", L + 50, y);
  doc.text("UNIT EXCL VAT", 166, y, { align: "right" }); doc.text("TOTAL EXCL VAT", RT - 2, y, { align: "right" });
  y += 8;
  doc.setFont("helvetica", "normal").setFontSize(8.8).setTextColor(...INK);
  po.items.forEach((it, idx) => {
    const d = doc.splitTextToSize(it.description || "", 78) as string[];
    const h = Math.max(1, d.length) * 4.2 + 3;
    if (y + h > 262) { doc.addPage(); y = 20; }
    if (bold && idx % 2 === 1) { doc.setFillColor(242, 249, 254).rect(L, y - 4.5, RT - L, h, "F"); }
    doc.setTextColor(...INK).text(String(Number(it.qty)), L + 2, y);
    doc.setFontSize(8).setTextColor(75, 90, 108).text(it.model_code || "", L + 14, y);
    doc.setFontSize(8.8).setTextColor(...INK).text(d, L + 50, y);
    doc.text(R(it.unit_cost_excl_vat), 166, y, { align: "right" }); doc.text(R(it.line_total_excl_vat), RT - 2, y, { align: "right" });
    doc.setDrawColor(227, 234, 242).setLineWidth(0.2).line(L, y - 4.5 + h, RT, y - 4.5 + h);
    y += h;
  });

  y += 6;
  // Totals + documents block stay together; never run into the footer (Johan 13 Oct 2026).
  if (y + 44 > 276) { doc.addPage(); y = 20; }
  ([["Subtotal excl VAT", po.subtotal], ["VAT 15%", po.vat_amount]] as const).forEach(([k, v]) => {
    doc.setTextColor(...INK).setFont("helvetica", "normal").text(k, 128, y); doc.text(R(v), RT - 2, y, { align: "right" }); y += 5.5;
  });
  if (bold) {
    doc.setDrawColor(...OR).setLineWidth(0.9).line(124, y - 3.5, RT, y - 3.5);
    doc.setTextColor(...B1);
  } else {
    doc.setFillColor(...B2).rect(124, y - 4, RT - 124, 7.5, "F");
    doc.setFillColor(...OR).rect(124, y - 4, 1.6, 7.5, "F");
    doc.setTextColor(255, 255, 255);
  }
  doc.setFont("helvetica", "bold").setFontSize(10.5).text("PO total incl VAT", 128, y + 1.2); doc.text(R(po.total), RT - 2, y + 1.2, { align: "right" });
  y += 16;

  doc.setTextColor(...OR).setFont("helvetica", "bold").setFontSize(7.5).text("DOCUMENTS", L, y);
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(9.5).text(poDocsLine(profile), L, y + 5);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUT).text(`Please quote ${po.po_number} on all invoices and delivery notes.`, L, y + 10);

  // Footer
  const fy = 284;
  if (bold) { doc.setFillColor(242, 249, 254).rect(0, fy - 6, 210, 13, "F"); doc.setFillColor(...B2).rect(0, fy - 6, 210, 0.9, "F"); }
  else { doc.setDrawColor(227, 234, 242).setLineWidth(0.2).line(L, fy - 5, RT, fy - 5); }
  doc.setTextColor(...B1).setFont("helvetica", "bold").setFontSize(7.5).text(id.legalName, L, fy - 1);
  doc.setFont("helvetica", "normal").setFontSize(7);
  doc.text([[id.tel && `Tel ${id.tel}`, id.email, id.web].filter(Boolean).join("  |  "), [id.addressLines.join(", "), id.vatNo && `VAT ${id.vatNo}`].filter(Boolean).join("  |  ")], L, fy + 2.5);
  return doc;
}

/** Loads an image URL into a PNG data URL for jsPDF (null if it can't load). */
export async function loadLogoForPdf(src: string): Promise<{ dataUrl: string; aspect: number } | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL("image/png"), aspect: img.naturalWidth / img.naturalHeight };
  } catch {
    return null;
  }
}

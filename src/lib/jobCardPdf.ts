/**
 * Job / warranty card PDF. Same A4 document family as quotes and invoices.
 * Bars are #3D9BE8. The warranty accent is #C2410C. No prices.
 * A typical card (2 units, 2 photos, 3 materials) stays on one page.
 * The signature and the consent line always stay on the same page.
 */
import { jsPDF } from "jspdf";
import type { JobCardModel } from "@/lib/jobCard";

const BAR: [number, number, number] = [61, 155, 232]; // #3D9BE8
const ACCENT: [number, number, number] = [194, 65, 12]; // #C2410C
const INK: [number, number, number] = [15, 27, 42];
const MUTED: [number, number, number] = [71, 85, 105];
const LINE: [number, number, number] = [226, 232, 240];
const WHITE: [number, number, number] = [255, 255, 255];

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 13;

function lineHeight(pt: number): number {
  return pt * 0.3528 * 1.2;
}

export function renderJobCardPdf(card: JobCardModel, logoDataUrl?: string | null): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  doc.setProperties({
    title: "Job / warranty card",
    author: card.company.legalName || "Job / warranty card",
    subject: "Job / warranty card",
  });

  let y = 10;

  const footer = () => {
    doc.setFillColor(...BAR);
    doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    const bits = [card.company.legalName, card.company.tel, card.company.vatNo ? `VAT ${card.company.vatNo}` : "", card.company.addressLines.join(", ")].filter(Boolean);
    doc.text(bits.join("  |  "), PAGE_W / 2, PAGE_H - 3.2, { align: "center", maxWidth: CONTENT_W });
  };

  const topBar = () => {
    doc.setFillColor(...BAR);
    doc.rect(0, 0, PAGE_W, 6, "F");
  };

  const newPage = () => {
    footer();
    doc.addPage();
    topBar();
    y = 10;
  };

  const measure = (value: string, size: number, width: number, gap: number) => {
    const lines: string[] = doc.splitTextToSize(value || "", width);
    return Math.max(lines.length, 1) * lineHeight(size) + gap;
  };

  const paint = (value: string, x: number, size: number, style: "normal" | "bold", color: [number, number, number], width = CONTENT_W, gap = 0.45) => {
    const lines: string[] = doc.splitTextToSize(value || "", width);
    const h = Math.max(lines.length, 1) * lineHeight(size);
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(lines, x, y + lineHeight(size) * 0.78);
    y += h + gap;
  };

  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };

  const text = (value: string, x: number, size: number, style: "normal" | "bold", color: [number, number, number], width = CONTENT_W, gap = 0.45) => {
    ensure(measure(value, size, width, gap));
    paint(value, x, size, style, color, width, gap);
  };

  topBar();

  if (logoDataUrl && /^data:image\/(png|jpe?g);base64,/i.test(logoDataUrl)) {
    try {
      const fmt = /png/i.test(logoDataUrl) ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmt, MARGIN, y, 44, 15);
    } catch {
      /* logo is optional; the legal name still prints */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text("JOB / WARRANTY CARD", PAGE_W - MARGIN, y + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(card.completedLabel ? `Completed ${card.completedLabel}` : "Completed", PAGE_W - MARGIN, y + 11, { align: "right" });
  y += 17;

  for (const line of card.companyLines) {
    const name = line === card.company.legalName;
    text(line, MARGIN, name ? 11 : 8, name ? "bold" : "normal", name ? INK : MUTED, 118, 0.15);
  }

  y += 1.2;
  doc.setFillColor(...ACCENT);
  doc.rect(MARGIN, y, CONTENT_W, 0.9, "F");
  y += 3.2;

  const colW = CONTENT_W / 2 - 2;
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 2;
  const blockTop = y;
  const paintColumn = (x: number, heading: string, lines: string[]) => {
    const saved = y;
    y = blockTop;
    text(heading, x, 7.5, "bold", BAR, colW, 0.25);
    for (const line of lines) text(line, x, 9, "normal", INK, colW, 0.15);
    const end = y;
    y = saved;
    return end;
  };
  const clientLines = [
    card.clientName,
    card.clientVat ? `VAT ${card.clientVat}` : "",
    card.siteAddress ? `Site: ${card.siteAddress}` : "",
  ].filter(Boolean);
  const jobLines = [
    card.jobTitle || "",
    card.jobTypeLabel,
    card.jobDatesLabel ? `Dates: ${card.jobDatesLabel}` : "",
  ].filter(Boolean);
  const leftEnd = paintColumn(leftX, "CLIENT", clientLines);
  const rightEnd = paintColumn(rightX, "JOB", jobLines);
  y = Math.max(leftEnd, rightEnd) + 2;

  text("WORK DONE", MARGIN, 7.5, "bold", BAR, CONTENT_W, 0.3);
  text(card.workDone, MARGIN, 9, "normal", INK, CONTENT_W, 1.4);

  text("UNITS", MARGIN, 7.5, "bold", BAR, CONTENT_W, 0.4);
  if (!card.units.length) {
    text("None recorded", MARGIN, 9, "normal", MUTED);
  } else {
    const cols = [36, 52, 42, CONTENT_W - 36 - 52 - 42];
    const headers = ["Brand", "Model", "Indoor / outdoor", "Serial"];
    const headH = 5.2;
    ensure(headH);
    doc.setFillColor(...BAR);
    doc.rect(MARGIN, y, CONTENT_W, headH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    let x = MARGIN + 1.2;
    headers.forEach((h, i) => {
      doc.text(h, x, y + 3.5);
      x += cols[i];
    });
    y += headH;
    card.units.forEach((u, idx) => {
      const cells = [u.brand, u.model, u.title, u.serial];
      const wrapped = cells.map((c, i) => doc.splitTextToSize(c, cols[i] - 2) as string[]);
      const rowH = Math.max(...wrapped.map((w) => w.length), 1) * lineHeight(8) + 0.9;
      ensure(rowH);
      if (idx % 2 === 0) {
        doc.setFillColor(244, 248, 252);
        doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      x = MARGIN + 1.2;
      wrapped.forEach((w, i) => {
        doc.text(w, x, y + lineHeight(8) * 0.82);
        x += cols[i];
      });
      y += rowH;
    });
    y += 2;
  }

  text("PHOTOS", MARGIN, 7.5, "bold", BAR, CONTENT_W, 0.4);
  if (!card.photos.length) {
    text("None for the card", MARGIN, 9, "normal", MUTED);
  } else {
    const boxW = (CONTENT_W - 3) / 2;
    const boxH = 42;
    const capH = 4.6;
    for (let i = 0; i < card.photos.length; i += 2) {
      ensure(boxH + 1.6);
      const row = card.photos.slice(i, i + 2);
      row.forEach((photo, col) => {
        const x = MARGIN + col * (boxW + 3);
        doc.setDrawColor(...LINE);
        doc.setFillColor(248, 250, 252);
        doc.rect(x, y, boxW, boxH, "FD");
        if (photo.dataUrl && /^data:image\/(png|jpe?g);base64,/i.test(photo.dataUrl)) {
          try {
            const fmt = /png/i.test(photo.dataUrl) ? "PNG" : "JPEG";
            doc.addImage(photo.dataUrl, fmt, x + 0.6, y + 0.6, boxW - 1.2, boxH - capH - 1);
          } catch {
            /* keep the empty frame */
          }
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...WHITE);
        doc.setFillColor(...BAR);
        const caption = photo.caption ? `${photo.label} - ${photo.caption}` : photo.label;
        doc.rect(x, y + boxH - capH, boxW, capH, "F");
        doc.text(doc.splitTextToSize(caption, boxW - 2)[0], x + 1.2, y + boxH - 1.4);
      });
      y += boxH + 2;
    }
  }

  text("MATERIALS USED", MARGIN, 7.5, "bold", BAR, CONTENT_W, 0.15);
  text("Names and quantities only. Prices stay on the invoice.", MARGIN, 7.5, "normal", MUTED, CONTENT_W, 0.45);
  if (!card.materials.length) {
    text("None recorded", MARGIN, 9, "normal", MUTED);
  } else {
    const headH = 5.2;
    ensure(headH);
    doc.setFillColor(...BAR);
    doc.rect(MARGIN, y, CONTENT_W, headH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    doc.text("Material", MARGIN + 1.2, y + 3.5);
    doc.text("Qty", MARGIN + CONTENT_W - 22, y + 3.5);
    y += headH;
    card.materials.forEach((m) => {
      const rowH = 4.8;
      ensure(rowH);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      doc.text(m.name, MARGIN + 1.2, y + 3.3);
      doc.text(m.qtyLabel, MARGIN + CONTENT_W - 22, y + 3.3);
      doc.setDrawColor(...LINE);
      doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
      y += rowH;
    });
    y += 1.6;
  }

  text("TIME ON SITE", MARGIN, 7.5, "bold", BAR, CONTENT_W, 0.25);
  for (const line of card.onSite) text(line, MARGIN, 9, "normal", INK, CONTENT_W, 0.15);
  text(`Technician: ${card.techSignOff}`, MARGIN, 9, "bold", INK, CONTENT_W, 1.3);

  text("WARRANTY", MARGIN, 7.5, "bold", ACCENT, CONTENT_W, 0.3);
  text(card.labourWarranty, MARGIN, 8, "bold", INK, CONTENT_W, 0.45);
  for (const line of card.warrantyLines) text(line, MARGIN, 8, "normal", INK, CONTENT_W, 0.5);

  // Signature, printed name, date and the consent line move together.
  const sigBody = card.signed ? 15 : 8.5;
  const sigBlock = measure("CLIENT SIGNATURE", 7.5, CONTENT_W, 0.3) + sigBody + measure(card.popia, 7.5, CONTENT_W, 0.4);
  ensure(sigBlock);
  paint("CLIENT SIGNATURE", MARGIN, 7.5, "bold", BAR, CONTENT_W, 0.3);
  if (card.signed) {
    if (card.signatureDataUrl && /^data:image\/(png|jpe?g);base64,/i.test(card.signatureDataUrl)) {
      try {
        const fmt = /png/i.test(card.signatureDataUrl) ? "PNG" : "JPEG";
        doc.addImage(card.signatureDataUrl, fmt, MARGIN, y, 50, 12);
      } catch {
        /* name and date still print */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(`Name: ${card.signatureName || card.clientName}`, MARGIN + 54, y + 4.5);
    doc.text(`Date: ${card.signatureDate || card.completedLabel}`, MARGIN + 54, y + 9);
    y += sigBody;
  } else {
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.35);
    doc.rect(MARGIN, y, CONTENT_W, 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text(card.unsignedLabel, MARGIN + 2, y + 4.7);
    y += sigBody;
  }
  paint(card.popia, MARGIN, 7.5, "normal", MUTED, CONTENT_W, 0.4);
  footer();

  return new Uint8Array(doc.output("arraybuffer"));
}

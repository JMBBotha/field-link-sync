/**
 * Job / warranty card PDF. Same A4 document family as quotes and invoices.
 * Bars are #3D9BE8. The warranty accent is #C2410C. No prices.
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
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

function lineHeight(pt: number): number {
  return pt * 0.3528 * 1.35;
}

export function renderJobCardPdf(card: JobCardModel, logoDataUrl?: string | null): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  doc.setProperties({
    title: "Job / warranty card",
    author: card.company.legalName || "Job / warranty card",
    subject: "Job / warranty card",
  });

  let y = 12;

  const footer = () => {
    doc.setFillColor(...BAR);
    doc.rect(0, PAGE_H - 10, PAGE_W, 10, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...WHITE);
    const bits = [card.company.legalName, card.company.tel, card.company.vatNo ? `VAT ${card.company.vatNo}` : "", card.company.addressLines.join(", ")].filter(Boolean);
    doc.text(bits.join("  |  "), PAGE_W / 2, PAGE_H - 4.2, { align: "center", maxWidth: CONTENT_W });
  };

  const topBar = () => {
    doc.setFillColor(...BAR);
    doc.rect(0, 0, PAGE_W, 8, "F");
  };

  const newPage = () => {
    footer();
    doc.addPage();
    topBar();
    y = 14;
  };

  const ensure = (h: number) => {
    if (y + h > PAGE_H - 16) newPage();
  };

  const text = (value: string, x: number, size: number, style: "normal" | "bold", color: [number, number, number], width = CONTENT_W, gap = 1.2) => {
    const lines: string[] = doc.splitTextToSize(value || "", width);
    const h = Math.max(lines.length, 1) * lineHeight(size);
    ensure(h + gap);
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(lines, x, y + lineHeight(size) * 0.75);
    y += h + gap;
  };

  topBar();

  if (logoDataUrl && /^data:image\/(png|jpe?g);base64,/i.test(logoDataUrl)) {
    try {
      const fmt = /png/i.test(logoDataUrl) ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmt, MARGIN, y, 52, 20);
    } catch {
      /* logo is optional; the legal name still prints */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text("JOB / WARRANTY CARD", PAGE_W - MARGIN, y + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(card.completedLabel ? `Completed ${card.completedLabel}` : "Completed", PAGE_W - MARGIN, y + 14, { align: "right" });
  y += 24;

  for (const line of card.companyLines) {
    text(line, MARGIN, line === card.company.legalName ? 12 : 9, line === card.company.legalName ? "bold" : "normal", line === card.company.legalName ? INK : MUTED, 120, 0.4);
  }

  ensure(4);
  y += 1;
  doc.setFillColor(...ACCENT);
  doc.rect(MARGIN, y, CONTENT_W, 1.3, "F");
  y += 5;

  const colW = CONTENT_W / 2 - 3;
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 3;
  const blockTop = y;
  const paintColumn = (x: number, heading: string, lines: string[]) => {
    const saved = y;
    y = blockTop;
    text(heading, x, 8, "bold", BAR, colW, 0.6);
    for (const line of lines) text(line, x, 10, "normal", INK, colW, 0.4);
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

  text("WORK DONE", MARGIN, 8, "bold", BAR, CONTENT_W, 0.6);
  text(card.workDone, MARGIN, 10, "normal", INK, CONTENT_W, 2);

  text("UNITS", MARGIN, 8, "bold", BAR, CONTENT_W, 1);
  if (!card.units.length) {
    text("None recorded", MARGIN, 10, "normal", MUTED);
  } else {
    const cols = [34, 48, 32, CONTENT_W - 34 - 48 - 32];
    const headers = ["Brand", "Model", "Indoor / outdoor", "Serial"];
    ensure(8);
    doc.setFillColor(...BAR);
    doc.rect(MARGIN, y, CONTENT_W, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...WHITE);
    let x = MARGIN + 1.5;
    headers.forEach((h, i) => {
      doc.text(h, x, y + 4.6);
      x += cols[i];
    });
    y += 7;
    card.units.forEach((u, idx) => {
      const cells = [u.brand, u.model, u.title, u.serial];
      const wrapped = cells.map((c, i) => doc.splitTextToSize(c, cols[i] - 2) as string[]);
      const rowH = Math.max(...wrapped.map((w) => w.length), 1) * lineHeight(8) + 2;
      ensure(rowH);
      if (idx % 2 === 0) {
        doc.setFillColor(244, 248, 252);
        doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      x = MARGIN + 1.5;
      wrapped.forEach((w, i) => {
        doc.text(w, x, y + lineHeight(8) * 0.8);
        x += cols[i];
      });
      y += rowH;
    });
    y += 3;
  }

  text("PHOTOS", MARGIN, 8, "bold", BAR, CONTENT_W, 1);
  if (!card.photos.length) {
    text("None for the card", MARGIN, 10, "normal", MUTED);
  } else {
    const boxW = (CONTENT_W - 4) / 2;
    const boxH = 38;
    for (let i = 0; i < card.photos.length; i += 2) {
      ensure(boxH + 8);
      const row = card.photos.slice(i, i + 2);
      row.forEach((photo, col) => {
        const x = MARGIN + col * (boxW + 4);
        doc.setDrawColor(...LINE);
        doc.setFillColor(248, 250, 252);
        doc.rect(x, y, boxW, boxH, "FD");
        if (photo.dataUrl && /^data:image\/(png|jpe?g);base64,/i.test(photo.dataUrl)) {
          try {
            const fmt = /png/i.test(photo.dataUrl) ? "PNG" : "JPEG";
            doc.addImage(photo.dataUrl, fmt, x + 1, y + 1, boxW - 2, boxH - 2);
          } catch {
            /* keep the empty frame */
          }
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...WHITE);
        doc.setFillColor(...BAR);
        const caption = photo.caption ? `${photo.label} - ${photo.caption}` : photo.label;
        doc.rect(x, y + boxH - 6, boxW, 6, "F");
        doc.text(doc.splitTextToSize(caption, boxW - 2)[0], x + 1.5, y + boxH - 2);
      });
      y += boxH + 3;
    }
  }

  text("MATERIALS USED", MARGIN, 8, "bold", BAR, CONTENT_W, 0.4);
  text("Names and quantities only. Prices stay on the invoice.", MARGIN, 8, "normal", MUTED, CONTENT_W, 1);
  if (!card.materials.length) {
    text("None recorded", MARGIN, 10, "normal", MUTED);
  } else {
    ensure(7);
    doc.setFillColor(...BAR);
    doc.rect(MARGIN, y, CONTENT_W, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...WHITE);
    doc.text("Material", MARGIN + 1.5, y + 4.6);
    doc.text("Qty", MARGIN + CONTENT_W - 28, y + 4.6);
    y += 7;
    card.materials.forEach((m) => {
      ensure(6.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(m.name, MARGIN + 1.5, y + 4.4);
      doc.text(m.qtyLabel, MARGIN + CONTENT_W - 28, y + 4.4);
      doc.setDrawColor(...LINE);
      doc.line(MARGIN, y + 6.2, MARGIN + CONTENT_W, y + 6.2);
      y += 6.5;
    });
    y += 2;
  }

  text("TIME ON SITE", MARGIN, 8, "bold", BAR, CONTENT_W, 0.6);
  for (const line of card.onSite) text(line, MARGIN, 10, "normal", INK, CONTENT_W, 0.3);
  text(`Technician: ${card.techSignOff}`, MARGIN, 10, "bold", INK, CONTENT_W, 2);

  text("WARRANTY", MARGIN, 8, "bold", ACCENT, CONTENT_W, 1);
  text(card.labourWarranty, MARGIN, 9, "bold", INK, CONTENT_W, 1.4);
  for (const line of card.warrantyLines) text(line, MARGIN, 9, "normal", INK, CONTENT_W, 1.1);

  text("CLIENT SIGNATURE", MARGIN, 8, "bold", BAR, CONTENT_W, 1);
  if (card.signed) {
    ensure(24);
    if (card.signatureDataUrl && /^data:image\/(png|jpe?g);base64,/i.test(card.signatureDataUrl)) {
      try {
        const fmt = /png/i.test(card.signatureDataUrl) ? "PNG" : "JPEG";
        doc.addImage(card.signatureDataUrl, fmt, MARGIN, y, 55, 18);
      } catch {
        /* name and date still print */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(`Name: ${card.signatureName || card.clientName}`, MARGIN + 62, y + 6);
    doc.text(`Date: ${card.signatureDate || card.completedLabel}`, MARGIN + 62, y + 12);
    y += 22;
  } else {
    ensure(12);
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, y, CONTENT_W, 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ACCENT);
    doc.text(card.unsignedLabel, MARGIN + 3, y + 6.5);
    y += 13;
  }

  text(card.popia, MARGIN, 8, "normal", MUTED, CONTENT_W, 2);
  footer();

  return new Uint8Array(doc.output("arraybuffer"));
}

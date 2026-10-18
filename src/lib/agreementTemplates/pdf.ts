import jsPDF from "jspdf";
import { docSections, fillFields, parseBody, parseInline, type Block, type FieldValues, type TemplateSection } from "./markup";

/**
 * Client PDF for an agreement template (Johan 18 Oct 2026): vector text, quote-terms styling
 * (blue numbered circle chips, uppercase blue headings, orange rule), company details from the
 * issuing company. Contract first, then the SLA as Schedule B on a new page.
 */

export interface AgreementCompany {
  name: string;
  short?: string;
  vat?: string | null;
  addressLines?: string[];
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  web?: string | null;
  banking?: string | null;
  signatory?: string | null;
  /** data: URL (PNG/JPEG) */
  logoDataUrl?: string | null;
}

export interface AgreementUnitRow {
  location?: string; type?: string; model?: string; serial?: string; size?: string; installDate?: string; byUs?: string; plan?: string; ref?: string;
}

export interface AgreementClient {
  name?: string; legalName?: string; regNo?: string; vat?: string; postalAddress?: string; siteAddress?: string;
  contact?: string; phone?: string; email?: string;
}

export interface AgreementPdfInput {
  title?: string;
  subtitle?: string;
  contractNo?: string;
  draft?: boolean;
  company: AgreementCompany;
  client?: AgreementClient;
  meta?: { startDate?: string; plan?: string; linked?: string; frequency?: string };
  units?: AgreementUnitRow[];
  sections: TemplateSection[];
  extraFields?: FieldValues;
}

const BLUE: [number, number, number] = [26, 167, 236];
const NAVY: [number, number, number] = [11, 79, 168];
const ORANGE: [number, number, number] = [247, 148, 29];
const INK: [number, number, number] = [29, 42, 58];
const BODY: [number, number, number] = [58, 72, 89];
const MUTED: [number, number, number] = [107, 122, 140];
const LINE: [number, number, number] = [210, 220, 232];

const PDF_OK = new Set("\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122\u00B7".split(""));

/** Standard PDF fonts only cover WinAnsi; replace the few characters outside it. */
export function pdfSafe(s: string): string {
  return (s || "")
    .replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[✓✔]/g, "v").replace(/[✗✘]/g, "x")
    .replace(/[→]/g, "->").replace(/[←]/g, "<-").replace(/[≈]/g, "~").replace(/[\u2009\u202f\u00a0]/g, " ")
    .replace(/[\u2011\u2012]/g, "-")
    .split("").filter((ch) => PDF_OK.has(ch) || (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e) || (ch.charCodeAt(0) >= 0xa0 && ch.charCodeAt(0) <= 0xff) || ch === "\n").join("");
}

export function companyFields(c: AgreementCompany): FieldValues {
  return {
    "company.name": c.name,
    "company.short": c.short || c.name,
    "company.vat": c.vat || "",
    "company.address": (c.addressLines || []).join(", "),
    "company.phone": c.phone || "",
    "company.whatsapp": c.whatsapp || "",
    "company.email": c.email || "",
    "company.web": c.web || "",
    "company.banking": c.banking || "",
    "company.signatory": c.signatory || "",
  };
}

export function buildAgreementPdf(input: AgreementPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const CW = W - M * 2;
  const BOTTOM = H - 18;
  const fields: FieldValues = { ...companyFields(input.company), ...(input.extraFields || {}) };
  const fill = (s: string) => pdfSafe(fillFields(s, fields));
  let y = 0;

  const runningHead = () => {
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.8); doc.line(M, 10, M + CW * 0.75, 10);
    doc.setDrawColor(...ORANGE); doc.line(M + CW * 0.75, 10, M + CW, 10);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(pdfSafe(`${input.company.name} · ${input.title || "Service contract"}${input.contractNo ? ` · ${input.contractNo}` : ""}`), M, 14.5);
    if (input.draft) { doc.setTextColor(...ORANGE); doc.setFont("helvetica", "bold"); doc.text("DRAFT", W - M, 14.5, { align: "right" }); }
    y = 20;
  };
  const newPage = () => { doc.addPage(); runningHead(); };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };

  // Rich text: wraps runs of bold/normal words into lines; returns height used.
  const rich = (text: string, x: number, width: number, size = 8.6, color: [number, number, number] = BODY, lead = 1.42, draw = true): number => {
    const lineH = (size * 0.3528) * lead;
    const words: { w: string; bold: boolean }[] = [];
    for (const r of parseInline(fill(text))) for (const w of r.text.split(/(\s+)/)) if (w) words.push({ w, bold: r.bold });
    const lines: { w: string; bold: boolean }[][] = [[]];
    let lineW = 0;
    doc.setFontSize(size);
    for (const t of words) {
      doc.setFont("helvetica", t.bold ? "bold" : "normal");
      const tw = doc.getTextWidth(t.w);
      if (/^\s+$/.test(t.w)) { if (lineW > 0) { lines[lines.length - 1].push({ w: " ", bold: t.bold }); lineW += doc.getTextWidth(" "); } continue; }
      if (lineW + tw > width && lineW > 0) {
        const cur = lines[lines.length - 1];
        while (cur.length && cur[cur.length - 1].w === " ") cur.pop();
        lines.push([]); lineW = 0;
      }
      lines[lines.length - 1].push(t); lineW += tw;
    }
    if (draw) {
      let ly = y;
      for (const ln of lines) {
        if (ly + lineH > BOTTOM) { newPage(); ly = y; }
        let lx = x;
        for (const t of ln) {
          doc.setFont("helvetica", t.bold ? "bold" : "normal");
          doc.setTextColor(...(t.bold ? INK : color));
          doc.text(t.w, lx, ly + lineH * 0.78);
          lx += doc.getTextWidth(t.w);
        }
        ly += lineH;
      }
      y = ly;
    }
    return lines.length * lineH;
  };

  const sectionHead = (chip: string, heading: string, keep = 16) => {
    ensure(keep);
    y += 3;
    doc.setFillColor(...BLUE); doc.circle(M + 3.1, y + 3, 3.1, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(255, 255, 255);
    doc.text(chip, M + 3.1, y + 4.15, { align: "center" });
    doc.setFontSize(8.8); doc.setTextColor(...NAVY);
    doc.text(fill(heading).toUpperCase(), M + 8.5, y + 4.1, { charSpace: 0.25 });
    y += 7.2;
    doc.setDrawColor(...ORANGE); doc.setLineWidth(0.45); doc.line(M, y, M + CW, y);
    y += 2.6;
  };

  const table = (header: string[], rows: string[][], widths?: number[]) => {
    const n = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const ws = widths && widths.length === n ? widths : (n === 2 ? [0.28, 0.72] : Array(n).fill(1 / n));
    const colW = ws.map((f) => f * CW);
    const pad = 1.3;
    const drawRow = (cells: string[], head: boolean) => {
      const size = head ? 6.8 : 7.8;
      const hs = cells.map((c, i) => rich(head ? c.toUpperCase() : c, 0, colW[i] - pad * 2, size, head ? NAVY : BODY, 1.35, false));
      const h = Math.max(3.4, ...hs) + pad * 2;
      if (y + h > BOTTOM) { newPage(); }
      const top = y;
      let x = M;
      cells.forEach((c, i) => {
        y = top + pad;
        rich(head ? `**${c.toUpperCase()}**` : c, x + pad, colW[i] - pad * 2, size, head ? NAVY : BODY, 1.35);
        x += colW[i];
      });
      y = top + h;
      doc.setDrawColor(...(head ? BLUE : LINE)); doc.setLineWidth(head ? 0.6 : 0.2); doc.line(M, y, M + CW, y);
    };
    drawRow([...header, ...Array(n - header.length).fill("")], true);
    for (const r of rows) drawRow([...r, ...Array(n - r.length).fill("")], false);
    y += 2;
  };

  const blocks = (list: Block[]) => {
    for (const b of list) {
      if (b.type === "table") { table(b.header, b.rows); continue; }
      ensure(6);
      if (b.type === "clause" || (b.type === "bullet" && b.num)) {
        const indent = b.type === "bullet" ? 3 : 0;
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.6); doc.setTextColor(...BLUE);
        doc.text(b.num!, M + indent, y + 3.4);
        rich(b.text, M + indent + 9, CW - indent - 9);
      } else if (b.type === "bullet") {
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.6); doc.setTextColor(...BLUE);
        doc.text("\u2022", M + 2, y + 3.4);
        rich(b.text, M + 6, CW - 6);
      } else {
        rich(b.text, M, CW);
      }
      y += 1.4;
    }
  };

  const signatures = (intro: string) => {
    if (intro.trim()) blocks(parseBody(intro));
    ensure(52);
    const bw = (CW - 8) / 2;
    const box = (x: number, title: string, name?: string, cap?: string) => {
      let by = y;
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(...BLUE);
      doc.text(pdfSafe(title).toUpperCase(), x, by + 3); by += 6;
      for (const [label, val, big] of [["Name", name], ["Capacity", cap], ["Signature", "", true], ["Date", ""], ["Place", ""], ["Witness", ""]] as [string, string | undefined, boolean?][]) {
        const h = big ? 11 : 6.5;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.6); doc.setTextColor(...MUTED);
        doc.text(label, x, by + h - 1.2);
        if (val) { doc.setTextColor(...INK); doc.text(pdfSafe(val), x + 18, by + h - 1.6); }
        doc.setDrawColor(185, 198, 212); doc.setLineWidth(0.25); doc.line(x + 17, by + h - 0.6, x + bw, by + h - 0.6);
        by += h;
      }
      return by;
    };
    const a = box(M, `For ${input.company.name}`, input.company.signatory || "", "Authorised signatory");
    const b = box(M + bw + 8, "For the Client", input.client?.name || input.client?.legalName || "", "");
    y = Math.max(a, b) + 3;
  };

  const units = (intro: string) => {
    if (intro.trim()) blocks(parseBody(intro));
    const header = ["#", "Location / room", "Unit type", "Brand and model", "Serial no.", "Size (BTU)", "Install date", "By us? (Y/N)", "Plan / ref"];
    const rows = (input.units && input.units.length ? input.units : Array.from({ length: 10 }, () => ({} as AgreementUnitRow)))
      .map((u, i) => [String(i + 1), u.location || "", u.type || "", u.model || "", u.serial || "", u.size || "", u.installDate || "", u.byUs || "", [u.plan, u.ref].filter(Boolean).join(" · ")]);
    table(header, rows, [0.04, 0.14, 0.11, 0.19, 0.13, 0.08, 0.11, 0.09, 0.11]);
  };

  const renderDoc = (list: TemplateSection[], chipPrefix = "") => {
    list.forEach((s, i) => {
      const chip = s.kind === "units" ? "A" : `${chipPrefix}${String(i + 1).padStart(2, "0")}`;
      sectionHead(chip, s.heading || "Section", s.kind === "signatures" ? 78 : s.kind === "units" ? 40 : 18);
      if (s.kind === "signatures") signatures(s.body);
      else if (s.kind === "units") units(s.body);
      else blocks(parseBody(s.body));
    });
  };

  // ---- page 1 header ----
  y = 12;
  let lx = M;
  if (input.company.logoDataUrl) {
    try {
      const fmt = /^data:image\/jpe?g/i.test(input.company.logoDataUrl) ? "JPEG" : "PNG";
      doc.addImage(input.company.logoDataUrl, fmt, M, y, 36, 22.5);
      lx = M + 40;
    } catch { /* logo optional */ }
  }
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.6); doc.line(lx, y + 0.5, lx, y + 23);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.2); doc.setTextColor(...NAVY);
  doc.text(pdfSafe(input.company.name), lx + 3.5, y + 3.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
  const coLines = [
    ...(input.company.addressLines || []),
    [input.company.phone && `Tel ${input.company.phone}`, input.company.whatsapp && `WhatsApp ${input.company.whatsapp}`].filter(Boolean).join(" · "),
    [input.company.email, input.company.web].filter(Boolean).join(" · "),
    input.company.vat ? `VAT ${input.company.vat}` : "",
  ].filter(Boolean) as string[];
  coLines.forEach((l, i) => doc.text(pdfSafe(l), lx + 3.5, y + 7.5 + i * 3.3));
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...NAVY);
  doc.text(pdfSafe((input.title || "Service contract").toUpperCase()), W - M, y + 7, { align: "right", charSpace: 0.6 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.2); doc.setTextColor(...MUTED);
  doc.text(pdfSafe(input.subtitle || "Air conditioning maintenance agreement"), W - M, y + 12, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setTextColor(...ORANGE);
  doc.text(pdfSafe(input.contractNo || "SC-____-___"), W - M, y + 16.5, { align: "right" });
  if (input.draft) {
    doc.setFontSize(6.6);
    const pw = doc.getTextWidth("DRAFT - FOR REVIEW") + 6;
    doc.setFillColor(...ORANGE); doc.roundedRect(W - M - pw, y + 18.5, pw, 5, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255); doc.text("DRAFT - FOR REVIEW", W - M - pw / 2, y + 21.9, { align: "center" });
  }
  y += 27;
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.line(M, y, M + CW * 0.75, y);
  doc.setDrawColor(...ORANGE); doc.line(M + CW * 0.75, y, M + CW, y);
  y += 5;

  // Parties
  const c = input.client || {};
  const half = (CW - 8) / 2;
  const partyTop = y;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BLUE);
  doc.text("SERVICE PROVIDER", M, y + 2); doc.text("CLIENT", M + half + 8, y + 2);
  let py = y + 7;
  doc.setFontSize(9.6); doc.setTextColor(...NAVY); doc.text(pdfSafe(input.company.name), M, py);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.6); doc.setTextColor(...BODY);
  [((input.company.addressLines || []).join(", ")), input.company.vat ? `VAT ${input.company.vat}` : "", input.company.signatory ? `Authorised: ${input.company.signatory}` : ""]
    .filter(Boolean).forEach((l) => { py += 3.8; doc.text(doc.splitTextToSize(pdfSafe(l), half), M, py); });
  let cy = partyTop + 4;
  const clientRows: [string, string | undefined][] = [
    ["Client name", c.name], ["Company / reg. no.", [c.legalName && c.legalName !== c.name ? c.legalName : "", c.regNo].filter(Boolean).join(" · ")],
    ...(c.vat ? [["VAT no.", c.vat] as [string, string]] : [["ID or VAT no.", ""] as [string, string]]),
    ["Postal address", c.postalAddress], ["Site address", c.siteAddress], ["Contact person", c.contact], ["Phone / WhatsApp", c.phone], ["Email", c.email],
  ];
  const cx = M + half + 8;
  for (const [label, val] of clientRows) {
    cy += 4.6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); doc.setTextColor(...MUTED); doc.text(label, cx, cy);
    if (val) { doc.setTextColor(...INK); doc.text(doc.splitTextToSize(pdfSafe(val), half - 30)[0], cx + 30, cy - 0.3); }
    doc.setDrawColor(185, 198, 212); doc.setLineWidth(0.2); doc.line(cx + 29, cy + 0.8, cx + half, cy + 0.8);
  }
  y = Math.max(py, cy) + 5;
  // Meta strip
  const meta = input.meta || {};
  doc.setFillColor(242, 248, 253); doc.roundedRect(M, y, CW, 10, 1.5, 1.5, "F");
  const mcols: [string, string][] = [["Contract no", input.contractNo || "[SC-____-___]"], ["Start date", meta.startDate || "[__ / __ / ____]"], ["Frequency", meta.frequency || "[as per clause 3]"], ["Linked quote / invoice", meta.linked || "[_______]"]];
  mcols.forEach(([k, v], i) => {
    const mx = M + 4 + i * (CW / 4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(...MUTED); doc.text(k, mx, y + 3.8);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.8); doc.setTextColor(...NAVY); doc.text(doc.splitTextToSize(pdfSafe(v), CW / 4 - 6)[0], mx, y + 7.8);
  });
  y += 13;

  const contract = docSections(input.sections, "contract");
  const sla = docSections(input.sections, "sla");
  renderDoc(contract);
  if (sla.length) {
    newPage();
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...NAVY);
    doc.text("SCHEDULE B - SERVICE LEVEL AGREEMENT", M, y + 5, { charSpace: 0.4 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(pdfSafe(`Forms part of ${input.contractNo || "the Service Contract"} between ${input.company.name} and the Client.`), M, y + 10);
    y += 14;
    renderDoc(sla, "B");
  }

  // footers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(...MUTED);
    doc.text(pdfSafe([input.company.name, input.company.vat && `VAT ${input.company.vat}`].filter(Boolean).join(" · ")), M, H - 8);
    doc.text(`Initials:  Client ________   Provider ________`, W / 2 + 12, H - 8, { align: "center" });
    doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: "right" });
  }
  return doc;
}

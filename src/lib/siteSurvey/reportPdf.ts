/** Branded Site Survey Report PDF (pdf-lib, A4). Staff and technicians only. Never prices. */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { ACCESS_FLAGS, ROOM_FLAGS, audioOf, btuLabel, frontPhoto, photosOf, voiceFor, type SurveyDraft } from "./model";

const W = 595.28, H = 841.89, M = 40;
const BRAND = rgb(0.06, 0.31, 0.55), INK = rgb(0.1, 0.12, 0.16), GREY = rgb(0.45, 0.48, 0.52), LINE = rgb(0.82, 0.85, 0.88), ORANGE = rgb(0.92, 0.45, 0.1);

export interface ReportInput {
  survey: SurveyDraft;
  client?: { name?: string | null; address?: string | null };
  companyName?: string | null;
  repName?: string | null;
  date?: string | null;                 // completed (or started) ISO time
  logo?: Uint8Array | null;            // PNG (company logo / 0800-BE-COOL card)
  image: (path: string) => Promise<Uint8Array | null>; // JPEG bytes for a stored photo
}

/** Strip characters the standard fonts cannot draw (keeps the report from failing on emoji etc.). */
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\n+/)) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

export async function buildSurveyReportPdf(inp: ReportInput): Promise<Uint8Array> {
  const d = inp.survey;
  const doc = await PDFDocument.create();
  doc.setTitle(`Site survey ${d.report_no ?? ""}`.trim());
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (inp.logo) { try { logo = await doc.embedPng(inp.logo); } catch { try { logo = await doc.embedJpg(inp.logo); } catch { logo = null; } } }
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];
  const header = () => {
    if (logo) { const h = 46, w = (logo.width / logo.height) * h; page.drawImage(logo, { x: M, y: H - M - h, width: w, height: h }); }
    page.drawText("SITE SURVEY REPORT", { x: W - M - bold.widthOfTextAtSize("SITE SURVEY REPORT", 15), y: H - M - 16, size: 15, font: bold, color: BRAND });
    const no = safe(d.report_no || "Draft");
    page.drawText(no, { x: W - M - bold.widthOfTextAtSize(no, 11), y: H - M - 32, size: 11, font: bold, color: ORANGE });
    page.drawLine({ start: { x: M, y: H - M - 56 }, end: { x: W - M, y: H - M - 56 }, thickness: 1, color: LINE });
    y = H - M - 74;
  };
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); header(); };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };
  const text = (s: string, o: { size?: number; f?: PDFFont; color?: any; x?: number; width?: number; gap?: number } = {}) => {
    const size = o.size ?? 10, f = o.f ?? font, x = o.x ?? M, width = o.width ?? W - 2 * M;
    for (const ln of wrap(s, f, size, width)) { need(size + 4); page.drawText(ln, { x, y: y - size, size, font: f, color: o.color ?? INK }); y -= size + (o.gap ?? 4); }
  };
  const photo = async (path: string | null | undefined, x: number, top: number, w: number, h: number, label: string) => {
    if (!path) return;
    const bytes = await inp.image(path);
    if (!bytes) return;
    let img: PDFImage;
    try { img = await doc.embedJpg(bytes); } catch { try { img = await doc.embedPng(bytes); } catch { return; } }
    const s = Math.min(w / img.width, h / img.height), iw = img.width * s, ih = img.height * s;
    page.drawImage(img, { x: x + (w - iw) / 2, y: top - h + (h - ih) / 2, width: iw, height: ih });
    page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: LINE, borderWidth: 0.5 });
    page.drawRectangle({ x: x + 3, y: top - h + 3, width: bold.widthOfTextAtSize(label, 8) + 6, height: 12, color: rgb(0, 0, 0), opacity: 0.6 });
    page.drawText(label, { x: x + 6, y: top - h + 6, size: 8, font: bold, color: rgb(1, 1, 1) });
  };
  header();

  // Client + visit
  const when = inp.date;
  text(safe(inp.client?.name || "Client"), { size: 14, f: bold });
  if (inp.client?.address) text(inp.client.address, { color: GREY });
  text([when ? `Surveyed ${new Date(when).toLocaleDateString("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" })}` : null,
    inp.repName ? `by ${inp.repName}` : null, inp.companyName].filter(Boolean).join(" · "), { color: GREY, size: 9 });
  y -= 6;
  const f = frontPhoto(d);
  if (f) { need(210); await photo(f.annotated_path || f.storage_path, M, y, W - 2 * M, 200, "Front of house"); y -= 212; }
  const access = ACCESS_FLAGS.filter((a) => d.access_flags?.[a.key]).map((a) => a.label);
  if (access.length || d.access_note) {
    text("Access", { f: bold, size: 11, color: BRAND });
    if (access.length) text(access.join(" · "));
    if (d.access_note) text(d.access_note, { color: GREY });
    for (const n of voiceFor(d, "access", null)) if (n.transcript && !(d.access_note ?? "").includes(n.transcript)) text(`Rep note: ${n.transcript}`, { color: GREY });
    y -= 6;
  }

  // Summary table: one line per room
  text("Rooms", { f: bold, size: 11, color: BRAND });
  const cols = [M, M + 150, M + 225, M + 285, M + 375, M + 455];
  const heads = ["Room", "Unit", "Pipe", "Wall", "Electrical", "Floor"];
  need(16); heads.forEach((h, i) => page.drawText(h, { x: cols[i], y: y - 9, size: 8, font: bold, color: GREY })); y -= 14;
  for (const r of d.rooms) {
    need(14);
    const cells = [r.name, r.unit_size_btu ? btuLabel(r.unit_size_btu) : "-", r.pipe_run_m != null ? `${r.pipe_run_m} m` : "-", r.wall_type || "-", r.electrical || "-", r.floor_level || "-"];
    cells.forEach((c, i) => page.drawText(safe(c).slice(0, i === 0 ? 30 : 16), { x: cols[i], y: y - 9, size: 9, font: i === 0 ? bold : font, color: INK }));
    page.drawLine({ start: { x: M, y: y - 13 }, end: { x: W - M, y: y - 13 }, thickness: 0.4, color: LINE });
    y -= 16;
  }
  y -= 8;

  // Per room detail with photos
  for (const [i, r] of d.rooms.entries()) {
    need(60);
    text(`${i + 1}. ${r.name}`, { f: bold, size: 12 });
    const bits = [r.unit_size_btu ? btuLabel(r.unit_size_btu) : null, r.pipe_run_m != null ? `Pipe run ${r.pipe_run_m} m` : null, r.wall_type, r.electrical, r.floor_level,
      r.core_holes ? `${r.core_holes} extra hole(s)` : null, ...ROOM_FLAGS.filter((x) => r.flags?.[x.key]).map((x) => x.label)].filter(Boolean);
    if (bits.length) text(bits.join(" · "), { color: GREY, size: 9 });
    const ind = photosOf(d, r.id, "indoor")[0], out = photosOf(d, r.id, "outdoor")[0];
    if (ind || out) {
      need(170); const w = (W - 2 * M - 10) / 2;
      await photo(ind && (ind.annotated_path || ind.storage_path), M, y, w, 160, "Indoor");
      await photo(out && (out.annotated_path || out.storage_path), M + w + 10, y, w, 160, "Outdoor");
      y -= 170;
    }
    if (r.note) text(r.note);
    const notes = [...(ind ? audioOf(d, ind.id) : []), ...(out ? audioOf(d, out.id) : []), ...voiceFor(d, "room", r.id)];
    for (const n of notes) if (n.transcript && !(r.note ?? "").includes(n.transcript)) text(`Rep note: ${n.transcript}`, { color: GREY });
    y -= 8;
  }

  pages.forEach((p, i) => {
    const foot = safe(`${d.report_no ?? "Draft"} · Site survey for staff and technicians · No prices · Page ${i + 1} of ${pages.length}`);
    p.drawText(foot, { x: M, y: M - 16, size: 7.5, font, color: GREY });
  });
  return doc.save();
}

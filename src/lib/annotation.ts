/** Site-photo annotation model (P2). Coordinates are 0..1 of the image size so strokes survive any display size. */
export type AnnColor = "#ef4444" | "#facc15" | "#ffffff";
export const ANN_COLORS: AnnColor[] = ["#ef4444", "#facc15", "#ffffff"];
export type AnnTool = "pen" | "arrow" | "text";
export interface AnnPoint { x: number; y: number }
export type AnnShape =
  | { t: "pen"; c: AnnColor; pts: AnnPoint[] }
  | { t: "arrow"; c: AnnColor; a: AnnPoint; b: AnnPoint }
  | { t: "text"; c: AnnColor; at: AnnPoint; text: string };
export interface Annotation { v: 1; shapes: AnnShape[] }

const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 10000) / 10000));
const pt = (p: AnnPoint): AnnPoint => ({ x: clamp(Number(p?.x)), y: clamp(Number(p?.y)) });
const col = (c: unknown): AnnColor => (ANN_COLORS.includes(c as AnnColor) ? (c as AnnColor) : "#ef4444");

export function serializeAnnotation(shapes: AnnShape[]): Annotation {
  return { v: 1, shapes: shapes.map(normShape).filter(Boolean) as AnnShape[] };
}

function normShape(s: AnnShape): AnnShape | null {
  if (!s) return null;
  if (s.t === "pen") return s.pts?.length ? { t: "pen", c: col(s.c), pts: s.pts.map(pt) } : null;
  if (s.t === "arrow") return { t: "arrow", c: col(s.c), a: pt(s.a), b: pt(s.b) };
  if (s.t === "text") return s.text?.trim() ? { t: "text", c: col(s.c), at: pt(s.at), text: String(s.text).slice(0, 80) } : null;
  return null;
}

export function parseAnnotation(raw: unknown): AnnShape[] {
  const a = raw as Annotation | null;
  if (!a || a.v !== 1 || !Array.isArray(a.shapes)) return [];
  return a.shapes.map(normShape).filter(Boolean) as AnnShape[];
}

/** Draw shapes onto a 2D context of size w×h. */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: AnnShape[], w: number, h: number) {
  const lw = Math.max(3, Math.round(Math.min(w, h) / 160));
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of shapes) {
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = lw;
    if (s.t === "pen") {
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
      ctx.stroke();
    } else if (s.t === "arrow") {
      const ax = s.a.x * w, ay = s.a.y * h, bx = s.b.x * w, by = s.b.y * h;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const ang = Math.atan2(by - ay, bx - ax), head = lw * 5;
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45));
      ctx.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    } else if (s.t === "text") {
      const fs = Math.max(16, Math.round(Math.min(w, h) / 22));
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 6); ctx.strokeStyle = s.c === "#ffffff" ? "#000000" : "#ffffff";
      ctx.strokeText(s.text, s.at.x * w, s.at.y * h); ctx.fillText(s.text, s.at.x * w, s.at.y * h);
    }
  }
}

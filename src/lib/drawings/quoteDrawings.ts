import { supabase } from "@/integrations/supabase/client";

export type DrawingKind = "pdf" | "png" | "boq_csv";
export interface QuoteDrawing {
  id: string;
  quote_id: string;
  filename: string;
  storage_path: string;
  kind: DrawingKind;
  area: string | null;
  revision: string | null;
  size_bytes: number | null;
  include_in_client_pdf: boolean;
  sort_order: number;
}

export const DRAWINGS_BUCKET = "quote-drawings";
export const DRAWING_MAX_BYTES = 10 * 1024 * 1024;
/** Signed links live 5 minutes. */
export const DRAWING_URL_TTL = 300;

/** Q-2026-0047_G1_mechanical_RevD.pdf | Q-2026-0047_G1_BOQ_RevD.csv */
export const DRAWING_NAME_RE = /^(Q-\d{4}-\d{3,5})_([A-Za-z0-9-]+)_(?:([A-Za-z0-9-]+)_)?(Rev[A-Z0-9]{1,3})\.(pdf|png|csv)$/;

export function parseDrawingName(name: string) {
  const m = DRAWING_NAME_RE.exec(name);
  if (!m) return null;
  const [, quoteNumber, area, label, revision, ext] = m;
  const isBoq = ext === "csv";
  if (isBoq && label !== "BOQ") return null;
  if (!isBoq && !label) return null;
  return { quoteNumber, area, label, revision, kind: (isBoq ? "boq_csv" : ext) as DrawingKind };
}

export function kindFromFile(f: File): DrawingKind | null {
  const n = f.name.toLowerCase();
  if (f.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (f.type === "image/png" || n.endsWith(".png")) return "png";
  if (n.endsWith(".csv")) return "boq_csv";
  return null;
}

const MIME: Record<DrawingKind, string> = { pdf: "application/pdf", png: "image/png", boq_csv: "text/csv" };
const EXT: Record<DrawingKind, string> = { pdf: "pdf", png: "png", boq_csv: "csv" };

/** Path is {company}/{quote}/{random}.{ext}: never a client name. */
export function drawingPath(companyId: string, quoteId: string, kind: DrawingKind) {
  return `${companyId}/${quoteId}/${crypto.randomUUID()}.${EXT[kind]}`;
}

export async function listQuoteDrawings(quoteId: string): Promise<QuoteDrawing[]> {
  const { data } = await supabase
    .from("quote_drawings" as never)
    .select("id, quote_id, filename, storage_path, kind, area, revision, size_bytes, include_in_client_pdf, sort_order")
    .eq("quote_id", quoteId)
    .order("sort_order")
    .order("created_at");
  return ((data || []) as unknown) as QuoteDrawing[];
}

export async function uploadQuoteDrawing(f: File, quoteId: string, companyId: string) {
  const kind = kindFromFile(f);
  if (!kind) throw new Error(`${f.name}: only PDF, PNG or BOQ CSV`);
  if (f.size > DRAWING_MAX_BYTES) throw new Error(`${f.name} is bigger than 10 MB`);
  const parsed = parseDrawingName(f.name);
  const path = drawingPath(companyId, quoteId, kind);
  const { error: up } = await supabase.storage.from(DRAWINGS_BUCKET).upload(path, f, { contentType: MIME[kind] });
  if (up) throw up;
  const { error } = await supabase.from("quote_drawings" as never).insert({
    quote_id: quoteId,
    company_id: companyId,
    storage_path: path,
    filename: f.name,
    kind,
    area: parsed?.area ?? null,
    revision: parsed?.revision ?? null,
    size_bytes: f.size,
    include_in_client_pdf: kind !== "boq_csv",
  } as never);
  if (error) {
    await supabase.storage.from(DRAWINGS_BUCKET).remove([path]);
    throw error;
  }
}

export async function setDrawingIncluded(id: string, include: boolean) {
  const { error } = await supabase.from("quote_drawings" as never).update({ include_in_client_pdf: include } as never).eq("id", id);
  if (error) throw error;
}

/** Admin only (RLS). Removes the row, then the file. */
export async function deleteQuoteDrawing(d: QuoteDrawing) {
  const { error } = await supabase.from("quote_drawings" as never).delete().eq("id", d.id);
  if (error) throw error;
  await supabase.storage.from(DRAWINGS_BUCKET).remove([d.storage_path]);
  await supabase.from("quote_drawings_deleted_files" as never).delete().eq("storage_path", d.storage_path);
}

export async function signedDrawingUrl(path: string) {
  const { data } = await supabase.storage.from(DRAWINGS_BUCKET).createSignedUrl(path, DRAWING_URL_TTL);
  return data?.signedUrl ?? null;
}

export interface DrawingPdfExtras {
  drawingPdfUrls: string[];
  drawingImageUrls: string[];
}

/** Included PDF/PNG drawings for the client PDF, in order. BOQ never. */
export async function loadQuoteDrawingsForPdf(quoteId?: string | null): Promise<DrawingPdfExtras> {
  const out: DrawingPdfExtras = { drawingPdfUrls: [], drawingImageUrls: [] };
  if (!quoteId) return out;
  try {
    const rows = (await listQuoteDrawings(quoteId)).filter((d) => d.include_in_client_pdf && d.kind !== "boq_csv");
    for (const d of rows) {
      const url = await signedDrawingUrl(d.storage_path);
      if (!url) continue;
      (d.kind === "pdf" ? out.drawingPdfUrls : out.drawingImageUrls).push(url);
    }
  } catch (e) {
    console.warn("[quoteDrawings] skipped drawings", e);
  }
  return out;
}

import { supabase } from "@/integrations/supabase/client";

/** Private supplier documents (delivery notes, supplier invoices, POs). Office only; DB RLS (sjd_ok) enforces it. */
export const sb = supabase as any;
export const SJD_BUCKET = "supplier-job-docs";

export const DOC_TYPES: [string, string][] = [
  ["delivery_note", "Delivery note"],
  ["supplier_invoice", "Supplier invoice"],
  ["purchase_order", "Purchase order"],
  ["supplier_quote", "Supplier quote"],
  ["credit_note", "Credit note"],
  ["warranty", "Warranty"],
  ["other", "Other"],
];
export const docTypeLabel = (t: string) => DOC_TYPES.find(([k]) => k === t)?.[1] ?? t;

export const DOC_SELECT =
  "id, company_id, supplier_name, doc_type, doc_number, po_number, doc_date, file_name, storage_path, source, notes, created_at, suppliers(name), supplier_job_document_lines(id, line_no, description, model_number, serial_number, qty, job_id, unit_detail_id), supplier_job_document_links(id, job_id, customer_id, status, reason, confidence, jobs(id, title, scheduled_for), customers(id, name))";

export async function openDocFile(path: string | null) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(SJD_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not open file");
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function linkDoc(documentId: string, jobId?: string | null, customerId?: string | null, note?: string | null, lines?: { line_id: string; qty: number; serials?: string[] }[] | null) {
  const { error } = await sb.rpc("sjd_link", { p_document_id: documentId, p_job_id: jobId ?? null, p_customer_id: customerId ?? null, p_note: note ?? null, p_lines: lines ?? null });
  if (error) throw error;
}
export async function unlinkDoc(linkId: string) {
  const { error } = await sb.rpc("sjd_unlink", { p_link_id: linkId });
  if (error) throw error;
}

export async function searchJobs(companyId: string, q: string) {
  const term = q.trim();
  let query = sb.from("jobs").select("id, title, scheduled_for, status, customer_id, customers(name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20);
  if (term) query = query.ilike("title", `%${term}%`);
  const { data } = await query;
  let rows = data ?? [];
  if (term) {
    const { data: c } = await sb.from("customers").select("id").eq("company_id", companyId).ilike("name", `%${term}%`).limit(20);
    const ids = (c ?? []).map((x: any) => x.id);
    if (ids.length) {
      const { data: more } = await sb.from("jobs").select("id, title, scheduled_for, status, customer_id, customers(name)").in("customer_id", ids).limit(20);
      const seen = new Set(rows.map((r: any) => r.id));
      rows = rows.concat((more ?? []).filter((r: any) => !seen.has(r.id)));
    }
  }
  return rows as any[];
}

/** Attach a file to a document that has none: uploads to <company>/<doc>/<file>, then sjd_attach_file records it. */
export async function attachDocFile(doc: { id: string; company_id: string }, file: File) {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";
  const path = `${doc.company_id}/${doc.id}/${safe}`;
  const up = await supabase.storage.from(SJD_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (up.error) throw up.error;
  const { error } = await sb.rpc("sjd_attach_file", { p_document_id: doc.id, p_storage_path: path, p_file_name: file.name, p_mime_type: file.type || null });
  if (error) throw error;
}

import { supabase } from "@/integrations/supabase/client";

/**
 * Delete one job/booking/site photo: the job_photos row, then its storage objects (original + mark-up).
 * RLS decides who may (photo_lead_ok: company-scoped; admins/dispatchers any lead, techs/reps only assigned).
 * Zero rows back = not allowed, so nothing is removed from storage.
 */
export async function deleteJobPhoto(id: string): Promise<void> {
  const { data, error } = await supabase.from("job_photos").delete().eq("id", id).select("id, storage_path, annotated_path");
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) throw new Error("You can't delete this photo.");
  const paths = [row.storage_path, row.annotated_path].filter(Boolean) as string[];
  if (paths.length) {
    const { error: se } = await supabase.storage.from("job-photos").remove(paths);
    if (se) throw new Error(`Photo removed from the record, but the file wasn't: ${se.message}`);
  }
}

/** Quote photo: quote_attachments row, then the quote-photos object (photo_quote_ok / quote_photo_ok policies). */
export async function deleteQuotePhoto(storagePath: string): Promise<void> {
  const { data, error } = await supabase.from("quote_attachments").delete().eq("storage_path", storagePath).select("id");
  if (error) throw error;
  if (!(data ?? []).length) throw new Error("You can't delete this photo.");
  const { error: se } = await supabase.storage.from("quote-photos").remove([storagePath]);
  if (se) throw new Error(`Photo removed from the quote, but the file wasn't: ${se.message}`);
}

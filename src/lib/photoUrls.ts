import { supabase } from "@/integrations/supabase/client";

/** job-photos is a PRIVATE bucket: always sign (1 h). Prefer the annotated copy when there is one. */
export function photoDisplayPath(p: { storage_path: string; annotated_path?: string | null }): string {
  return p.annotated_path || p.storage_path;
}

export async function signedPhotoUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from("job-photos").createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

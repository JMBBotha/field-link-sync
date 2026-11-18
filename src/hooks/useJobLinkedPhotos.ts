import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  parseLinkedPhotoRows,
  unionLinkedPhotos,
  visibleLinkedPhotos,
  type LinkedBucket,
  type LinkedPhotoView,
} from "@/lib/linkedPhotos";

export function jobLinkedPhotosQueryKey(jobId: string, jobLeadId?: string | null) {
  return ["job-linked-photos", jobId, jobLeadId ?? null] as const;
}

async function signedBucketUrl(bucket: LinkedBucket, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

/** Read the job's linked photos and sign each existing path. Does not upload or copy. */
export async function loadJobLinkedPhotos(jobId: string, jobLeadId?: string | null): Promise<LinkedPhotoView[]> {
  const { data, error } = await (supabase.rpc as any)("job_linked_photos", { p_job: jobId });
  if (error) throw error;
  const photos = visibleLinkedPhotos(unionLinkedPhotos(parseLinkedPhotoRows(data)), jobLeadId);
  const signed = await Promise.all(photos.map(async (p) => ({ ...p, url: await signedBucketUrl(p.bucket, p.displayPath) })));
  return signed.filter((p) => p.url);
}

export function useJobLinkedPhotos(jobId: string | null | undefined, jobLeadId?: string | null) {
  return useQuery({
    queryKey: jobId ? jobLinkedPhotosQueryKey(jobId, jobLeadId) : ["job-linked-photos", "none"],
    enabled: !!jobId,
    queryFn: () => loadJobLinkedPhotos(jobId!, jobLeadId),
    staleTime: 60_000,
  });
}

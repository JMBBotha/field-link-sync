/** A lead raised from a service job (tech 'new quote' button) links to that job's photos; they stay on the job (Johan 14:45). */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SitePhotosReadOnly } from "./SitePhotosSection";

export default function LinkedJobPhotos({ leadId }: { leadId: string }) {
  const q = useQuery({
    queryKey: ["linked-job-photos", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: l } = await (supabase.from("leads") as any).select("source_job_id").eq("id", leadId).maybeSingle();
      if (!l?.source_job_id) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: j } = await (supabase.from("jobs") as any).select("lead_id").eq("id", l.source_job_id).maybeSingle();
      return (j?.lead_id as string | null) ?? null;
    },
  });
  if (!q.data || q.data === leadId) return null;
  return <div data-testid="linked-job-photos"><div className="mb-1 text-xs text-muted-foreground">Photos from the service job</div><SitePhotosReadOnly leadId={q.data} /></div>;
}

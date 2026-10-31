import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { JobPerms } from "@/lib/jobActionBar";

/** Server-checked job permissions. admin is true for a company admin or a sales login linked to one. */
export function useJobPermissions(jobId: string | undefined) {
  return useQuery({
    queryKey: ["job-perms", jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<JobPerms> => {
      const { data, error } = await (supabase.rpc as any)("my_job_permissions", { p_job: jobId });
      if (error) throw error;
      return (data ?? { admin: false, rep: false, tech: false }) as JobPerms;
    },
  });
}

import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useAuth } from "@/contexts/AuthContext";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { useToast } from "@/hooks/use-toast";

export interface JobCompletionInput {
  leadId: string;
  jobId?: string | null;
  workSummary: string;
  customerName?: string | null;
  customerEmail?: string | null;
  signatureDataUrl: string | null;
  partsTotal: number;
  labourMinutes: number;
  photoCount: number;
}

/**
 * Persists an on-site job completion (signature + parts + time + photos) and
 * flips the lead/job to completed. Works offline via the Dexie sync queue.
 */
export function useJobCompletion() {
  const { user } = useAuth();
  const { companyId } = useUserCompanyId();
  const { isOnline, queueOperation } = useOfflineContext();
  const { toast } = useToast();

  const submit = useCallback(
    async (input: JobCompletionInput): Promise<{ queued: boolean }> => {
      if (!user?.id) throw new Error("Not signed in");

      const completedAt = new Date().toISOString();
      const record = {
        company_id: companyId,
        lead_id: input.leadId,
        job_id: input.jobId ?? null,
        technician_id: user.id,
        work_summary: input.workSummary || null,
        customer_name: input.customerName || null,
        customer_email: input.customerEmail || null,
        signature_data_url: input.signatureDataUrl,
        signed_at: input.signatureDataUrl ? completedAt : null,
        parts_total: input.partsTotal,
        labour_minutes: input.labourMinutes,
        photo_count: input.photoCount,
        status: "completed",
        completed_at: completedAt,
      };

      if (!isOnline) {
        await queueOperation?.(
          "job_completion" as never,
          "job_completions",
          input.leadId,
          record as never
        );
        toast({
          title: "Saved offline",
          description: "Completion will sync automatically when you're back online.",
        });
        return { queued: true };
      }

      const { error } = await supabase
        .from("job_completions" as never)
        .upsert(record as never, { onConflict: "lead_id" });
      if (error) throw error;

      const { error: leadErr } = await supabase
        .from("leads")
        .update({ status: "completed", completed_at: completedAt })
        .eq("id", input.leadId);
      if (leadErr) throw leadErr;

      if (input.jobId) {
        await supabase
          .from("jobs")
          .update({ status: "completed", completed_at: completedAt })
          .eq("id", input.jobId);
      }

      return { queued: false };
    },
    [user?.id, companyId, isOnline, queueOperation, toast]
  );

  return { submit };
}

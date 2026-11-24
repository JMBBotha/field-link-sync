import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companyBlocksDocumentEdits } from "@/lib/documentPreviewChoices";

/**
 * companies.status for one document's company.
 * Archived and on_hold companies are history-only (is_company_writable is active-only).
 * Unknown (still loading, missing id, or the read failed) does not block — the server still refuses the write.
 */
export function useCompanyWritable(companyId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["company-status", companyId ?? null],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("status").eq("id", companyId!).maybeSingle();
      if (error) throw error;
      return (data?.status as string | null) ?? "active";
    },
  });
  const known = !!companyId && query.isSuccess;
  const blocked = companyBlocksDocumentEdits(query.data, known);
  return { allowsEdit: !blocked, blocked, status: query.data ?? null };
}

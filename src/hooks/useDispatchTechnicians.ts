import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dispatchTechPhase, heldCompanyId } from "@/lib/techPicker";

export type DispatchTech = { id: string; name: string };

/** Technicians for a visit row. A refresh that drops companyId does not look like an empty company. */
export function useDispatchTechnicians(companyId: string | null | undefined, enabled: boolean) {
  const held = useRef<string | null>(null);
  if (companyId) held.current = companyId;
  const id = heldCompanyId(companyId, held.current);
  const q = useQuery({
    queryKey: ["dispatchable-techs", id],
    enabled: enabled && !!id,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("dispatchable_technicians", { _company_id: id });
      if (error) throw error;
      return ((data ?? []) as any[]).map((t) => ({
        id: (t.id ?? t.profile_id) as string,
        name: (t.full_name ?? t.name ?? "Technician") as string,
      })) as DispatchTech[];
    },
  });
  const phase = dispatchTechPhase({
    companyId: id,
    isPending: q.isPending,
    isFetching: q.isFetching,
    isError: q.isError,
    count: q.data?.length ?? 0,
  });
  return { ...q, phase, companyId: id };
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { v8Notes, V8_PARK_FIELD, V8_LOST_FIELD, type V8NoteRow } from "@/lib/v8Flow";

/** Park + Lost reason notes, stored as audit rows in status_change_log (RLS: company staff, same as other quote logs). */
export function useV8Notes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["v8-notes"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase.from("status_change_log") as any)
        .select("entity_id, field_name, new_status, created_at").eq("entity_type", "quote")
        .in("field_name", [V8_PARK_FIELD, V8_LOST_FIELD]).order("created_at", { ascending: false }).limit(2000);
      return v8Notes((data || []) as V8NoteRow[]);
    },
  });
  const write = async (quote: { id: string; company_id: string }, field: string, value: string | null) => {
    const { error } = await (supabase.from("status_change_log") as any).insert({
      entity_type: "quote", entity_id: quote.id, field_name: field, old_status: null, new_status: value, changed_by: user?.id, company_id: quote.company_id,
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["v8-notes"] });
  };
  return { parked: q.data?.parked || {}, lost: q.data?.lost || {}, write };
}

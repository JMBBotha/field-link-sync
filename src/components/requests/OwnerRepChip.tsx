import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { setOwnerRep } from "@/lib/requests";

/** Client's owning rep: gets Move requests (internal sale) and the commission. Admin can change it with a reason (logged). */
export default function OwnerRepChip({ customerId, companyId, ownerRepId, canEdit }: { customerId: string; companyId?: string | null; ownerRepId?: string | null; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [rep, setRep] = useState<string>(ownerRepId ?? "");
  const [reason, setReason] = useState("");
  const { data: reps = [] } = useQuery({
    queryKey: ["owner-rep-options", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, dispatch_role").eq("company_id", companyId!).in("dispatch_role", ["sales", "sales_engineer"]).order("full_name");
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });
  const { data: ownerName } = useQuery({
    queryKey: ["owner-rep-name", ownerRepId],
    enabled: !!ownerRepId,
    queryFn: async () => (await supabase.from("profiles").select("full_name").eq("id", ownerRepId!).maybeSingle()).data?.full_name ?? null,
  });
  const save = async () => {
    if (!reason.trim()) return toast.error("Add a reason");
    const r = await setOwnerRep(customerId, rep || null, reason.trim());
    if (r.ok) { toast.success("Client's rep updated"); setEditing(false); setReason(""); qc.invalidateQueries(); } else toast.error(r.message || "Could not save");
  };
  return (
    <div className="mt-2 text-sm text-[#CFE6F6]" data-testid="owner-rep">
      Client's rep: <span className="font-semibold text-white">{ownerName?.trim() || "not set"}</span>
      <span className="opacity-80"> · moves go to them as an internal sale</span>
      {canEdit && !editing && <button onClick={() => setEditing(true)} className="ml-2 font-semibold text-white underline">Change</button>}
      {editing && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-xl bg-white/10 p-2">
          <select value={rep} onChange={(e) => setRep(e.target.value)} className="min-h-11 rounded-lg px-2 text-[15px] text-black" aria-label="Client's rep">
            <option value="">No rep</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="min-h-11 min-w-48 flex-1 rounded-lg px-2 text-[15px] text-black" />
          <button onClick={save} className="min-h-11 rounded-lg bg-white px-3 font-semibold text-[#0F2A44]">Save</button>
          <button onClick={() => setEditing(false)} className="min-h-11 px-2 text-white">Cancel</button>
        </div>
      )}
    </div>
  );
}

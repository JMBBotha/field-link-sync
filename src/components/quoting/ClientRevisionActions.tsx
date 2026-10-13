// Management one-tap approve/reject for a client's self-adjusted quote (Johan 2026-10-13). The database checks the role.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n || 0);

export default function ClientRevisionActions({ revision }: { revision: { id: string; total: number; original_total: number | null; lines: any[] } }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    if (!window.confirm(approve ? `Approve the client's revised quote (${fmt(revision.total)})? It becomes the live quote.` : "Reject the client's changes? The original quote stays live.")) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("decide_client_revision" as never, { p_revision_id: revision.id, p_approve: approve } as never);
      if (error) throw error;
      toast({ title: approve ? "Client changes approved" : "Client changes rejected" });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["quote-client-revisions-pending"] });
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  const summary = (revision.lines || []).map((l: any) => `${l.quantity}× ${l.name}`).join("\n");
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" title={summary}>
      <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">Revised by client · {fmt(revision.total)}</span>
      <Button size="sm" className="h-6 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy} onClick={() => decide(true)}>Approve</Button>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => decide(false)}>Reject</Button>
    </div>
  );
}

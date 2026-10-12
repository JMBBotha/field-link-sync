import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { ACTION_LABEL, flagsByLead, whenText, type DupAction, type DupFlag } from "@/lib/sameClient";

/** Admin/office only (the RPC returns nothing for techs and reps). One shared query for every card. */
export function useDuplicateFlags() {
  return useQuery({
    queryKey: ["lead-duplicate-flags"],
    staleTime: 60_000,
    queryFn: async () => {
      const rpc = (supabase as any).rpc;
      if (typeof rpc !== "function") return new Map<string, DupFlag>();
      const { data, error } = await rpc.call(supabase, "lead_duplicate_flags");
      if (error) return new Map<string, DupFlag>();
      return flagsByLead(data as DupFlag[]);
    },
  });
}

export default function DuplicateClientBadge({ leadId }: { leadId: string }) {
  const { data } = useDuplicateFlags();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DupAction | null>(null);
  const flag = data?.get(leadId);
  if (!flag) return null;
  const n = (flag.n_others ?? 1) + 1;

  const run = async (action: DupAction) => {
    setBusy(action);
    const { error } = await (supabase as any).rpc("resolve_duplicate_lead", { p_lead: leadId, p_action: action, p_target: flag.other_lead_id });
    setBusy(null);
    if (error) { toast({ title: "Couldn't fix duplicate", description: error.message, variant: "destructive" }); return; }
    toast({ title: action === "keep_both" ? "Kept as a second visit" : action === "merge" ? "Merged into the other booking" : "Duplicate cancelled" });
    setOpen(false);
    qc.invalidateQueries();
  };

  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" data-testid="dup-client-badge" onClick={() => setOpen(true)}
        className={flag.match === "strong"
          ? "rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-amber-600"
          : "rounded border border-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"}>
        <Copy className="mr-0.5 inline h-3 w-3" />{flag.match === "strong" ? `Same client ×${n}` : "Same client?"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{flag.match === "strong" ? "Same client, another booking" : "Possibly the same client"}</DialogTitle>
            <DialogDescription>
              The other one is {flag.other_booked ? "booked" : "open"} for {whenText(flag.other_date, flag.other_time)}
              {flag.other_tech ? ` with ${flag.other_tech}` : ""} ({flag.other_status}).
              {flag.match !== "strong" && " Same address and a similar name, but a different phone/email."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {(["merge", "cancel", "keep_both"] as DupAction[]).map((a) => (
              <Button key={a} variant={a === "merge" ? "default" : "outline"} disabled={!!busy} onClick={() => run(a)}>
                {busy === a ? "Working…" : ACTION_LABEL[a]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}

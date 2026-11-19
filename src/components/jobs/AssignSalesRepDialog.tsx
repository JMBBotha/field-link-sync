import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { salesRepCandidates, type StaffChoice, type StaffPickRow } from "@/lib/salesRepAssign";

const ASSIGN_BTN = "bg-[#C2410C] text-white hover:bg-[#9A3412]";

export function SalesRepList({
  reps,
  value,
  onChange,
}: {
  reps: StaffChoice[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (!reps.length) {
    return <p className="text-sm text-muted-foreground" data-testid="sales-rep-empty">No active salespeople in this company.</p>;
  }
  return (
    <div role="listbox" aria-label="Salesperson" className="space-y-2" data-testid="sales-rep-list">
      {reps.map((rep) => {
        const on = value === rep.id;
        return (
          <button
            key={rep.id}
            type="button"
            role="option"
            aria-selected={on}
            data-testid="sales-rep-option"
            onClick={() => onChange(rep.id)}
            className={cn(
              "flex min-h-11 w-full items-center rounded-lg border px-3 text-left text-sm",
              on ? "border-[#3D9BEB] bg-[#3D9BEB]/10 font-semibold" : "border-border bg-background",
            )}
          >
            {rep.name}
          </button>
        );
      })}
    </div>
  );
}

export function useSalesRepChoices(companyId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["sales-rep-choices", companyId],
    enabled: enabled && !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, company_id, dispatch_role, participant_type, dispatch_active, archived_at")
        .eq("company_id", companyId!)
        .eq("dispatch_active", true)
        .is("archived_at", null)
        .order("full_name");
      if (error) throw error;
      return salesRepCandidates((data ?? []) as StaffPickRow[], companyId);
    },
  });
}

type AssignLead = {
  id: string;
  customer_name?: string | null;
  company_id?: string | null;
  assigned_agent_id?: string | null;
  assigned_to_name?: string | null;
};

/**
 * Name a salesperson on a sales lead. No date and no visit time.
 * `reps` is the harness list — when it is passed, nothing is loaded or saved live.
 */
export default function AssignSalesRepDialog({
  lead,
  onClose,
  onAssigned,
  reps,
  defaultRepId = "",
}: {
  lead: AssignLead | null;
  onClose: () => void;
  onAssigned?: (rep: StaffChoice) => void;
  reps?: StaffChoice[];
  /** Harness: start with this salesperson selected so the confirm button is active. */
  defaultRepId?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [repId, setRepId] = useState(defaultRepId);
  useEffect(() => { setRepId(defaultRepId); }, [lead?.id, defaultRepId]);

  const preview = !!reps;
  const companyId = lead?.company_id ?? null;
  const loaded = useSalesRepChoices(companyId, !!lead && !preview);
  const choices = reps ?? loaded.data ?? [];
  const reassign = !!lead?.assigned_agent_id;
  const label = reassign ? "Reassign rep" : "Assign rep";

  const save = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error("No lead");
      if (preview) return;
      const { data, error } = await (supabase.rpc as any)("assign_sales_lead", { p_lead_id: lead.id, p_rep_id: repId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || "Not saved");
    },
    onSuccess: () => {
      const chosen = choices.find((r) => r.id === repId);
      const name = chosen?.name || "salesperson";
      if (!preview) {
        toast({ title: reassign ? `Reassigned to ${name}` : `Assigned to ${name}` });
        ["dispatch-leads", "dispatch-cards-leads", "lead-assign-options", "leads", "lead"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      }
      if (chosen) onAssigned?.(chosen);
      setRepId("");
      onClose();
    },
    onError: (e: any) => toast({ title: "Not saved", description: e?.message || String(e), variant: "destructive" }),
  });

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) { setRepId(""); onClose(); } }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-md" data-testid="assign-rep-dialog">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {lead?.customer_name ? <span className="font-semibold">{lead.customer_name}</span> : "Sales lead"}
            {lead?.assigned_to_name ? ` · now with ${lead.assigned_to_name}` : ""}
            . No visit time — this only names the salesperson.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Salesperson</Label>
          {!preview && !companyId ? <p className="text-sm text-muted-foreground">This lead has no company.</p>
            : !preview && loaded.isLoading ? <p className="text-sm text-muted-foreground">Loading salespeople…</p>
            : !preview && loaded.isError ? <p className="text-sm text-destructive">Couldn't load salespeople.</p>
            : <SalesRepList reps={choices} value={repId} onChange={setRepId} />}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className={ASSIGN_BTN} disabled={!repId || save.isPending} onClick={() => save.mutate()} data-testid="assign-rep-save">
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ASSIGN_BTN };

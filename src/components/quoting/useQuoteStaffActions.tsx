import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { useLaneStaff } from "@/hooks/useLaneStaff";
import { ToastAction } from "@/components/ui/toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { RowMenuItem } from "@/components/shared/RowMenu";
import {
  canMarkQuote, canChangeSalesperson, snapshotOf, buildAcceptPatch, buildDeclinePatch,
  buildStatusUndoPatch, buildSalespersonPatch, buildLogRow, type StatusLogRow,
} from "@/lib/quoteStaffActions";

export type StaffQuote = {
  id: string; company_id: string; status: string | null; quote_number?: string | null;
  accepted_at?: string | null; accepted_by?: string | null; declined_at?: string | null;
  sales_engineer_id?: string | null; created_by?: string | null; owner_id?: string | null;
};

type Pending = { kind: "accept" | "decline"; quote: StaffQuote } | null;

/** Menu items + dialogs for staff quote actions. Render `dialogs` once per screen. */
export function useQuoteStaffActions(onChanged?: () => void) {
  const { user } = useAuth();
  const { roles } = useRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { salesStaff } = useLaneStaff();
  const [pending, setPending] = useState<Pending>(null);
  const [salesFor, setSalesFor] = useState<StaffQuote | null>(null);
  const [salesPick, setSalesPick] = useState<string>("");
  const userId = user?.id ?? null;

  const { data: me } = useQuery({
    queryKey: ["quote-staff-me", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("profiles") as any).select("full_name, dispatch_role").eq("id", userId).maybeSingle();
      return { name: (data?.full_name as string) || user?.email || "staff", dispatchRole: (data?.dispatch_role as string) ?? null };
    },
  });
  const access = { userId, roles: roles as string[], dispatchRole: me?.dispatchRole ?? null };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["estimate"] });
    qc.invalidateQueries({ queryKey: ["admin-quote"] });
    onChanged?.();
  };

  const write = async (q: StaffQuote, patch: Record<string, unknown>, log: StatusLogRow) => {
    const { error } = await (supabase.from("quotes") as any).update(patch).eq("id", q.id);
    if (error) throw error;
    await (supabase.from("status_change_log") as any).insert(log); // audit; never blocks the change
  };

  const runStatus = async (kind: "accept" | "decline", q: StaffQuote) => {
    if (!userId) return;
    const prev = snapshotOf(q);
    const patch = kind === "accept" ? buildAcceptPatch(me?.name || "staff") : buildDeclinePatch();
    try {
      await write(q, patch, buildLogRow(q, "status", prev.status, patch.status, userId));
      refresh();
      toast({
        title: kind === "accept" ? "Marked accepted" : "Marked declined",
        description: kind === "accept" ? "Deposit invoice is created automatically." : undefined,
        action: (
          <ToastAction altText="Undo" onClick={async () => {
            const undo = buildStatusUndoPatch(prev);
            try { await write(q, undo, buildLogRow(q, "status", patch.status, prev.status, userId)); refresh(); toast({ title: "Undone" }); }
            catch (e: any) { toast({ title: "Undo failed", description: e.message, variant: "destructive" }); }
          }}>Undo</ToastAction>
        ),
      });
    } catch (e: any) {
      toast({ title: "Could not update quote", description: e.message, variant: "destructive" });
    }
  };

  const runSalesperson = async (q: StaffQuote, next: string) => {
    if (!userId) return;
    const prev = q.sales_engineer_id ?? null;
    if (prev === next) return;
    try {
      await write(q, buildSalespersonPatch(next), buildLogRow(q, "sales_engineer_id", prev, next, userId));
      refresh();
      const name = salesStaff.find((s) => s.id === next)?.full_name || "new salesperson";
      toast({
        title: `Salesperson: ${name}`,
        action: (
          <ToastAction altText="Undo" onClick={async () => {
            try { await write(q, buildSalespersonPatch(prev), buildLogRow(q, "sales_engineer_id", next, prev, userId)); refresh(); toast({ title: "Undone" }); }
            catch (e: any) { toast({ title: "Undo failed", description: e.message, variant: "destructive" }); }
          }}>Undo</ToastAction>
        ),
      });
    } catch (e: any) {
      toast({ title: "Could not change salesperson", description: e.message, variant: "destructive" });
    }
  };

  const itemsFor = (q: StaffQuote): RowMenuItem[] => {
    const canMark = !!me && canMarkQuote(access, q);
    const s = String(q.status || "").toLowerCase();
    return [
      { label: "Mark accepted", hidden: !canMark || s === "accepted", onSelect: () => setPending({ kind: "accept", quote: q }), separatorBefore: true },
      { label: "Mark declined", hidden: !canMark || s === "declined", onSelect: () => setPending({ kind: "decline", quote: q }) },
      { label: "Change salesperson…", hidden: !me || !canChangeSalesperson(access), onSelect: () => { setSalesPick(q.sales_engineer_id || ""); setSalesFor(q); } },
    ];
  };

  const dialogs = (
    <>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.kind === "accept" ? "Mark this quote accepted?" : "Mark this quote declined?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "accept"
                ? "Use this when the client accepted by phone or email. The deposit invoice is created, as with an online acceptance. No client signature is recorded."
                : "Use this when the client declined by phone or email."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const p = pending; setPending(null); if (p) void runStatus(p.kind, p.quote); }}>
              {pending?.kind === "accept" ? "Mark accepted" : "Mark declined"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!salesFor} onOpenChange={(o) => !o && setSalesFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Change salesperson</DialogTitle></DialogHeader>
          <Select value={salesPick} onValueChange={setSalesPick}>
            <SelectTrigger><SelectValue placeholder="Pick a salesperson" /></SelectTrigger>
            <SelectContent>
              {salesStaff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalesFor(null)}>Cancel</Button>
            <Button disabled={!salesPick} onClick={() => { const q = salesFor; setSalesFor(null); if (q && salesPick) void runSalesperson(q, salesPick); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { itemsFor, dialogs };
}

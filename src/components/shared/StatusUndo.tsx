import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useStatusUndo } from "@/hooks/useStatusUndo";
import { clearAllStacks, describeEntry, type StatusUndoEntry } from "@/lib/statusUndo";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const QUOTE_UNDO_NOTE = "Anything already created (like a deposit invoice) stays.";

/** Toast Undo action + revert with the shared messages. */
export function useUndoAction() {
  const { toast } = useToast();
  const { revert, record } = useStatusUndo();
  const run = async (e: StatusUndoEntry) => {
    const r = await revert(e);
    if (r.result === "stale") toast({ title: "Changed since — not undone" });
    else if (r.result === "error") toast({ title: "Undo failed", description: r.message, variant: "destructive" });
    else toast({ title: "Undone", description: e.entity_type === "quote" ? QUOTE_UNDO_NOTE : undefined });
  };
  const action = (e: StatusUndoEntry | null) =>
    e ? <ToastAction altText="Undo" onClick={() => void run(e)}>Undo</ToastAction> : undefined;
  return { record, run, action };
}

/** Header button: 'Undo last status change' for this session. Clears stacks on sign-out. */
export function StatusUndoButton() {
  const { last } = useStatusUndo();
  const { run } = useUndoAction();
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") clearAllStacks(); });
    return () => data.subscription.unsubscribe();
  }, []);

  const label = last ? describeEntry(last) : "Undo last status change";
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!last} aria-label={label} onClick={() => setConfirm(true)}>
                <Undo2 className="h-4 w-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{last ? label : "Undo last status change — nothing to undo"}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo last status change?</AlertDialogTitle>
            <AlertDialogDescription>
              {last ? label : ""}
              {last?.entity_type === "quote" ? ` ${QUOTE_UNDO_NOTE}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (last) void run(last); }}>Undo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Change an invoice's due date. Server checks the role (owner/admin/sales owner) and logs the change. */
export function InvoiceDueDateEdit({ invoice, onDone }: { invoice: any; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(invoice?.due_date ?? "");
  const [busy, setBusy] = useState(false);
  if (!invoice || ["paid", "void", "cancelled"].includes(invoice.status)) return null;
  const fmt = (d?: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "not set";
  const save = async () => {
    if (!val) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("set_invoice_due_date", { p_invoice: invoice.id, p_due: val, p_reason: null });
    setBusy(false);
    if (error) { toast.error(error.message || "Could not change the due date"); return; }
    toast.success(data?.unchanged ? "Due date unchanged" : `Due date changed to ${fmt(val)}`);
    setOpen(false); onDone?.();
  };
  return (
    <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2 px-1 text-sm" data-testid="due-date-edit">
      <span className="text-muted-foreground">Due {fmt(invoice.due_date)}</span>
      {open ? (<>
        <Input type="date" value={val} onChange={(e) => setVal(e.target.value)} className="h-8 w-40" />
        <Button size="sm" className="h-8" onClick={save} disabled={busy || !val}>Save</Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>Cancel</Button>
      </>) : (<Button size="sm" variant="link" className="h-8 px-1" onClick={() => setOpen(true)}>Change</Button>)}
    </div>);
}

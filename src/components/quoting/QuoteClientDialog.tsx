import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUnifiedClients } from "@/hooks/useUnifiedClients";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type QuoteClientMode = "change" | "duplicate";

/** Real client records only (lead-only rows can't own a quote). */
export function clientChoices(clients: { id: string; customer_id?: string; name: string; phone?: string; email?: string | null }[], term: string) {
  const list = clients
    .filter((c) => c.customer_id && !String(c.customer_id).startsWith("lead-"))
    .map((c) => ({ id: c.customer_id as string, name: c.name, phone: c.phone || "", email: c.email || "" }));
  const q = term.trim().toLowerCase();
  const hit = q ? list.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q)) : list;
  return hit.slice(0, 30);
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: QuoteClientMode;
  quoteId: string;
  quoteNumber?: string | null;
  currentCustomerId?: string | null;
  currentCustomerName?: string | null;
  /** change: called after the switch is saved. duplicate: called with the new quote id. */
  onDone: (result: { quoteId: string; customerId: string; customerName: string }) => void;
}

/** Search + confirm a client, then change a draft's client or duplicate the quote for that client. */
export default function QuoteClientDialog({ open, onOpenChange, mode, quoteId, quoteNumber, currentCustomerId, currentCustomerName, onDone }: Props) {
  const { data: clients = [] } = useUnifiedClients();
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = useMemo(() => clientChoices(clients as any, term), [clients, term]);

  const close = (o: boolean) => { if (!o) { setPicked(null); setTerm(""); } onOpenChange(o); };

  const confirm = async () => {
    const target = picked ?? (mode === "duplicate" && currentCustomerId ? { id: currentCustomerId, name: currentCustomerName || "" } : null);
    if (!target) return;
    setBusy(true);
    try {
      if (mode === "change") {
        const { error } = await (supabase as any).rpc("change_quote_client", { p_quote_id: quoteId, p_customer_id: target.id });
        if (error) throw error;
        toast({ title: `Client changed to ${target.name}`, description: "Lines and prices were not changed." });
        onDone({ quoteId, customerId: target.id, customerName: target.name });
      } else {
        const { data, error } = await (supabase as any).rpc("duplicate_quote", { p_quote_id: quoteId, p_customer_id: target.id });
        if (error) throw error;
        toast({ title: "Quote duplicated", description: `New draft for ${target.name}. The original is unchanged.` });
        onDone({ quoteId: data as string, customerId: target.id, customerName: target.name });
      }
      close(false);
    } catch (e: any) {
      toast({ title: mode === "change" ? "Client not changed" : "Quote not duplicated", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "change" ? "Change client" : "Duplicate quote";
  const canConfirm = mode === "duplicate" ? true : !!picked && picked.id !== currentCustomerId;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}{quoteNumber ? ` · ${quoteNumber}` : ""}</DialogTitle>
          <DialogDescription>
            {mode === "change"
              ? "Pick the client this draft is for. Lines, quantities, prices, discount, VAT and terms stay exactly as they are."
              : "Creates a new draft with its own quote number and link. Pick another client, or keep the same one."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Current client: <span className="font-medium text-foreground">{currentCustomerName || "—"}</span></p>
        <Input autoFocus placeholder="Search name, phone or email…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <div className="max-h-64 overflow-y-auto rounded-md border" role="listbox" aria-label="Clients">
          {choices.length === 0 && <p className="p-3 text-sm text-muted-foreground">No clients found.</p>}
          {choices.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={picked?.id === c.id}
              onClick={() => setPicked({ id: c.id, name: c.name })}
              className={cn("block w-full px-3 py-2 text-left hover:bg-muted", picked?.id === c.id && "bg-primary/10")}>
              <p className="text-sm font-medium">{c.name}{c.id === currentCustomerId ? " (current)" : ""}</p>
              <p className="text-xs text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
            </button>
          ))}
        </div>
        {picked && (
          <p className="text-sm">
            {mode === "change"
              ? <>Switch this quote from <b>{currentCustomerName || "—"}</b> to <b>{picked.name}</b>?</>
              : <>Duplicate for <b>{picked.name}</b>.</>}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || !canConfirm}>
            {busy ? "Working…" : mode === "change" ? "Confirm change" : picked ? "Duplicate" : "Duplicate for same client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

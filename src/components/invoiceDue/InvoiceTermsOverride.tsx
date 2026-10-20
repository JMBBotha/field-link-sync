import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { termsLabel } from "@/lib/invoiceDue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Optional per-invoice payment terms override (owner/admin). Empty = use the client's terms. */
export function InvoiceTermsOverride({ invoice }: { invoice: { id: string; payment_terms_basis?: string | null; payment_terms_days?: number | null } }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [b, setB] = useState<string>(invoice.payment_terms_basis || "client");
  const [d, setD] = useState<number>(invoice.payment_terms_days ?? 30);
  const save = async () => {
    const { error } = await (supabase as any).rpc("set_invoice_payment_terms", { p_invoice: invoice.id, p_basis: b === "client" ? null : b, p_days: d });
    if (error) return toast.error(error.message);
    toast.success("Invoice terms saved"); setOpen(false);
    qc.invalidateQueries({ queryKey: ["invoice-due"] }); qc.invalidateQueries({ queryKey: ["customer-invoices"] });
  };
  if (!open) return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="mt-2 text-xs text-[#1590D6] hover:underline" data-testid="invoice-terms-override">
      Terms for this invoice: {invoice.payment_terms_basis ? termsLabel(invoice.payment_terms_basis, invoice.payment_terms_days) : "same as client"} · change
    </button>);
  return (
    <div onClick={(e) => e.stopPropagation()} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border p-2 text-sm">
      <select value={b} onChange={(e) => setB(e.target.value)} className="rounded-lg border bg-background px-2 py-1">
        <option value="client">Same as client</option><option value="invoice">Days after invoice</option><option value="completion">Days after job completion</option>
      </select>
      {b !== "client" && <Input type="number" min={0} max={365} value={d} onChange={(e) => setD(Math.max(0, Math.min(365, Number(e.target.value) || 0)))} className="h-8 w-20" />}
      <Button size="sm" onClick={save} className="bg-[#F7941D] hover:bg-[#e08310] text-white">Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>);
}

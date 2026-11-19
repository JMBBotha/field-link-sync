import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDay } from "@/lib/balanceDue";
import { expectedFinalPaymentDate } from "@/lib/adminHomeCount";
import { jhbDate } from "@/lib/drilldown";

/**
 * Expected final payment on one invoice.
 * Empty means the invoice issue date. Saving writes invoices.expected_final_payment_date
 * through the signed-in update (RLS and enforce_company_writable stay in charge).
 * The column may not exist until its migration is applied; the date then stays the invoice date.
 * This block is screen-only and is not part of the PDF.
 */
export function ExpectedFinalPaymentField({
  invoice,
  onDone,
  preview = false,
  readOnly = false,
}: {
  invoice: {
    id: string;
    status?: string | null;
    issue_date?: string | null;
    created_at?: string | null;
    expected_final_payment_date?: string | null;
  };
  onDone?: () => void;
  /** Harness only. Keeps the date on screen and does not write. */
  preview?: boolean;
  /** View-only login. Shows the date and hides the editor. */
  readOnly?: boolean;
}) {
  const issue = jhbDate(invoice.issue_date) || jhbDate(invoice.created_at);
  const [stored, setStored] = useState<string | null>(jhbDate(invoice.expected_final_payment_date));
  const [val, setVal] = useState(stored || issue || "");
  const [busy, setBusy] = useState(false);
  const locked = ["void", "cancelled", "canceled"].includes(String(invoice.status || "").toLowerCase());
  const effective = expectedFinalPaymentDate({ ...invoice, expected_final_payment_date: stored });
  const usingInvoiceDate = !stored;
  const shown = effective
    ? `${fmtDay(effective)}${usingInvoiceDate ? ", the invoice date" : ""}`
    : "not set";

  const save = async (next: string | null) => {
    const clean = next && next !== issue ? next : null;
    if (preview) {
      setStored(clean);
      setVal(clean || issue || "");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("invoices").update({ expected_final_payment_date: clean }).eq("id", invoice.id);
    setBusy(false);
    if (error) {
      const missing = /expected_final_payment_date|schema cache|PGRST204/i.test(error.message || "");
      toast.error(missing
        ? "Expected final payment is not on this database yet. The date shown is the invoice date."
        : (error.message || "Could not save the expected final payment"));
      return;
    }
    setStored(clean);
    setVal(clean || issue || "");
    toast.success(clean ? `Expected final payment ${fmtDay(clean)}` : "Expected final payment uses the invoice date");
    onDone?.();
  };

  return (
    <div className="print:hidden mx-auto mb-2 max-w-3xl rounded-xl border border-[#E3E8EF] bg-white/95 px-3 py-2 text-sm text-[#0F1B2A] dark:border-[#1F3550] dark:bg-[#0F1B2A]/95 dark:text-[#EAF2FA]" data-testid="expected-final-payment">
      <div className="font-semibold">Expected final payment</div>
      <p className="text-[13px] text-[#4e6d86] dark:text-[#d5e4f2]" data-testid="expected-final-payment-shown">Showing {shown}. This does not change the invoice total.</p>
      {!locked && !readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Expected final payment"
            value={val}
            onChange={(event) => setVal(event.target.value)}
            className="h-10 w-40"
          />
          <Button type="button" size="sm" className="h-10 bg-[#C2410C] text-white hover:bg-[#9A3412]" onClick={() => save(val || null)} disabled={busy}>Save</Button>
          <Button type="button" size="sm" variant="outline" className="h-10" data-testid="expected-final-payment-reset" onClick={() => save(null)} disabled={busy || usingInvoiceDate}>Use invoice date</Button>
        </div>
      )}
    </div>
  );
}

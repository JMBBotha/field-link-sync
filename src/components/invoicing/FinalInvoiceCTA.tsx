import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { finalInvoiceStep } from "@/lib/invoiceMoney";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FinalStep, FinalStepJob } from "@/lib/invoiceMoney";

const rand = (n: number) => "R " + Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ");

/** V8 orange primary next step: deposit paid + job done → send the final invoice. */
export default function FinalInvoiceCTA({ step, className }: { step: FinalStep | null; className?: string }) {
  const navigate = useNavigate();
  if (!step) return null;
  return (
    <div className={"rounded-2xl border border-orange-300 bg-orange-50 p-3 dark:bg-orange-500/10 " + (className || "")} data-testid="final-invoice-cta">
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">Next step · {step.jobDone ? "job done, deposit paid" : "deposit paid, final invoice ready"}</p>
      <Button
        className="mt-2 h-12 w-full rounded-xl bg-orange-500 text-base font-semibold text-white hover:bg-orange-600"
        onClick={() => navigate(`/admin/invoices/${step.invoiceId}?final=1`)}
      >
        <Send className="mr-2 h-5 w-5" /> Send final invoice · {rand(step.balance)}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">{step.invoiceNumber || "Invoice"} · balance due on completion</p>
    </div>
  );
}

/** Job page: same rule, loading the client's invoices + payments. */
export function FinalInvoiceCTAForJob({ customerId, job, className }: { customerId?: string | null; job: FinalStepJob; className?: string }) {
  const { data } = useQuery({
    queryKey: ["final-invoice-step", customerId, job.id, job.status],
    enabled: !!customerId,
    queryFn: async () => {
      const { data: invs } = await (supabase as any).from("invoices").select("id, invoice_number, status, grand_total, sent_at, archived_at").eq("customer_id", customerId);
      const ids = (invs || []).map((i: any) => i.id);
      const { data: pays } = ids.length ? await (supabase as any).from("payments").select("invoice_id, amount, status").in("invoice_id", ids) : { data: [] };
      return finalInvoiceStep(invs || [], pays || [], [job]);
    },
  });
  return <FinalInvoiceCTA step={data ?? null} className={className} />;
}

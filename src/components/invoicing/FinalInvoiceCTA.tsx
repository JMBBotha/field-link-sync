import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { finalInvoiceStep } from "@/lib/invoiceMoney";
import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useHeartbeatAudience } from "@/hooks/useSalesHeartbeat";
import { convertQuoteToInvoice } from "@/lib/convertQuoteToInvoice";
import { toast } from "@/hooks/use-toast";
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
        <Send className="mr-2 h-5 w-5" /> {step.sentLabel ? "Send again" : "Send final invoice"} · {rand(step.balance)}
      </Button>
      {step.sentLabel
        ? <p data-testid="final-sent-label" className="mt-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ {step.sentLabel}</p>
        : <p className="mt-1 text-xs text-muted-foreground">{step.invoiceNumber || "Invoice"} · not sent yet</p>}
    </div>
  );
}

/** Job page: same rule, loading the client's invoices + payments. */
export function FinalInvoiceCTAForJob({ customerId, job, className }: { customerId?: string | null; job: FinalStepJob & { quote_id?: string | null }; className?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  // p118: technician-only users mark the job complete; admin or sales raise the final invoice.
  const aud = useHeartbeatAudience();
  const staff = aud.canSee;
  const done = ["completed", "installed", "done", "complete"].includes(String(job.status || "").toLowerCase()) || !!job.completed_at;
  const { data } = useQuery({
    queryKey: ["final-invoice-step", customerId, job.id, job.status, job.quote_id],
    enabled: !!customerId && staff,
    queryFn: async () => {
      const { data: invs } = await (supabase as any).from("invoices").select("id, invoice_number, status, grand_total, sent_at, archived_at, final_sent_at, final_sent_channel, quote_id").eq("customer_id", customerId);
      const ids = (invs || []).map((i: any) => i.id);
      const { data: pays } = ids.length ? await (supabase as any).from("payments").select("invoice_id, amount, status").in("invoice_id", ids) : { data: [] };
      const step = finalInvoiceStep(invs || [], pays || [], [job]);
      // p116: job done, deposit paid in full, but no balance invoice yet → offer to create it (draft, nothing is sent).
      let createBalance = 0;
      if (!step && done && job.quote_id) {
        const { data: q } = await (supabase as any).from("quotes").select("total").eq("id", job.quote_id).maybeSingle();
        const live = (invs || []).filter((i: any) => i.quote_id === job.quote_id && !i.archived_at && !["void", "cancelled"].includes(String(i.status || "").toLowerCase()));
        const invoiced = live.reduce((t: number, i: any) => t + (Number(i.grand_total) || 0), 0);
        const left = (Number(q?.total) || 0) - invoiced;
        if (live.length > 0 && left > 0.5) createBalance = left;
      }
      return { step, createBalance };
    },
  });
  if (!staff) return null;
  if (data?.step || !data?.createBalance) return <FinalInvoiceCTA step={data?.step ?? null} className={className} />;
  const create = async () => {
    if (!user?.id || !job.quote_id) return;
    setBusy(true);
    try {
      const id = await convertQuoteToInvoice(job.quote_id, user.id);
      toast({ title: "Final invoice ready", description: "Nothing was sent. Check it and tap Send." });
      navigate(`/admin/invoices/${id}?final=1`);
    } catch (e: any) {
      toast({ title: e?.message || "Could not create the final invoice", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <div className={"rounded-2xl border border-orange-300 bg-orange-50 p-3 dark:bg-orange-500/10 " + (className || "")} data-testid="final-invoice-create">
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">Next step · job done, deposit paid</p>
      <Button className="mt-2 h-12 w-full rounded-xl bg-orange-500 text-base font-semibold text-white hover:bg-orange-600" onClick={create} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />} Final invoice · {rand(data.createBalance)}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">Creates the balance invoice as a draft · nothing is sent</p>
    </div>
  );
}

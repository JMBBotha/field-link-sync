/**
 * Office "Invoice requests" (Johan 23:11): every tech completion arrives here flagged
 * "As quoted" or "Changes" (extra materials/time). Approve = reuse/create the DRAFT balance invoice and add
 * the extras at catalogue sell price (approve_invoice_request). Nothing is sent to the client — the office reviews and sends.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";

export interface InvoiceRequestRow {
  id: string; lead_id: string; job_id: string | null; customer_name: string | null; technician_id: string | null;
  as_quoted: boolean; extra_items: { product_id: string | null; name: string; qty: number }[];
  extra_hours: number | null; note: string | null; started_at: string | null; finished_at: string | null;
  status: string; invoice_id: string | null; created_at: string;
}

export function requestFlag(r: Pick<InvoiceRequestRow, "as_quoted" | "extra_items" | "extra_hours">): string {
  if (r.as_quoted) return "As quoted";
  const parts = [r.extra_items?.length ? "extra materials" : null, r.extra_hours ? "time" : null].filter(Boolean);
  return `Changes: ${parts.join("/") || "see note"}`;
}

export default function InvoiceRequestsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["invoice-requests"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("invoice_requests" as never) as any)
        .select("id, lead_id, job_id, customer_name, technician_id, as_quoted, extra_items, extra_hours, note, started_at, finished_at, status, invoice_id, created_at")
        .eq("status", "pending").order("created_at", { ascending: true }).limit(50);
      if (error) throw error;
      const rows = (data || []) as InvoiceRequestRow[];
      const techIds = [...new Set(rows.map((r) => r.technician_id).filter(Boolean))] as string[];
      let names: Record<string, string> = {};
      if (techIds.length) {
        const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", techIds);
        names = Object.fromEntries((ps || []).map((p: any) => [p.id, (p.full_name || "").trim()]));
      }
      return { rows, names };
    },
  });
  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;

  const approve = async (r: InvoiceRequestRow) => {
    setBusy(r.id);
    const { data: invId, error } = await (supabase.rpc as any)("approve_invoice_request", { p_id: r.id });
    setBusy(null);
    if (error) { toast({ title: "Could not approve", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["invoice-requests"] });
    qc.invalidateQueries({ queryKey: ["ready-to-invoice"] });
    toast({
      title: "Approved – draft invoice ready",
      description: r.as_quoted ? "Check it and send it when you're happy." : "Extras were added at catalogue price. Review before sending.",
      action: invId ? <ToastAction altText="Open draft" onClick={() => navigate(`/admin/invoices/${invId}`)}>Open draft</ToastAction> : undefined,
    });
    if (invId) navigate(`/admin/invoices/${invId}`);
  };

  return (
    <Card id="invoice-requests" className="surface-card border-sky-500/40" data-testid="invoice-requests-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-sky-600" />
          Invoice requests
          <Badge className="border-0 bg-sky-500/15 text-sky-700 dark:text-sky-300">{rows.length}</Badge>
          <span className="ml-auto text-xs font-normal text-muted-foreground">From technicians · nothing is sent until you send it</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {rows.map((r) => (
          <div key={r.id} className="space-y-1.5 rounded-md border p-2.5" data-testid="invoice-request-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm">{r.customer_name || "Job"}</span>
              <Badge className={r.as_quoted ? "border-0 bg-green-600 text-white" : "border-0 bg-orange-500 text-white"} data-testid="invoice-request-flag">
                {requestFlag(r)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {data?.names[r.technician_id ?? ""] || "Technician"} · finished {formatDistanceToNowStrict(new Date(r.finished_at || r.created_at))} ago
              </span>
            </div>
            {!r.as_quoted && (
              <ul className="ml-1 list-disc pl-4 text-xs">
                {r.extra_items.map((x, i) => <li key={i}>{x.qty} × {x.name}{x.product_id ? "" : " (not in catalogue – price needed)"}</li>)}
                {r.extra_hours ? <li>Extra time: {r.extra_hours} h</li> : null}
              </ul>
            )}
            {r.note && <p className="text-xs italic text-muted-foreground">“{r.note}”</p>}
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={busy === r.id} onClick={() => approve(r)} data-testid="invoice-request-approve">
                {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve → draft invoice
              </Button>
              {r.job_id && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/admin/jobs/${r.job_id}`)}>Open job</Button>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { FilePlus, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CreateInvoiceDialog from "@/components/invoicing/CreateInvoiceDialog";
import { formatRand } from "@/utils/formatRand";

interface ReadyRow {
  lead_id: string;
  customer_name: string;
  customer_id: string | null;
  customer_phone: string;
  customer_address: string;
  service_type: string | null;
  completed_at: string | null;
  quote_id: string | null;
  quote_number: string | null;
  quote_total: number | null;
  invoice_number: string | null;
  invoice_state: "none" | "deposit_only" | "invoiced";
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ReadyToInvoiceCard = () => {
  const { user } = useAuth();
  const [dialogRow, setDialogRow] = useState<ReadyRow | null>(null);

  const { data: rows = [], refetch } = useQuery({
    queryKey: ["ready-to-invoice"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("lead_invoice_status" as any) as any)
        .select("lead_id, customer_name, customer_id, customer_phone, customer_address, service_type, completed_at, quote_id, quote_number, quote_total, invoice_number, invoice_state")
        .neq("invoice_state", "invoiced")
        .order("completed_at", { ascending: true, nullsFirst: true })
        .limit(50);
      if (error) throw error;
      return (data || []) as ReadyRow[];
    },
  });

  if (rows.length === 0) return null;

  // Always open the editor (autofilled from the job) so nothing is saved without review.
  const handleClick = (row: ReadyRow) => setDialogRow(row);

  return (
    <Card id="ready-to-invoice" className="surface-card border-amber-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-amber-600" />
          Ready to invoice ({rows.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">Completed jobs with no invoice yet</p>
      </CardHeader>
      <CardContent className="max-h-72 overflow-y-auto space-y-2 pt-0">
        {rows.map((row) => {
          const ageMs = row.completed_at ? Date.now() - new Date(row.completed_at).getTime() : null;
          const red = ageMs === null || ageMs >= DAY_MS;
          const deposit = row.invoice_state === "deposit_only";
          return (
            <div key={row.lead_id} className="flex items-center gap-2 rounded-md border p-2">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="font-semibold text-sm truncate">{row.customer_name}</div>
                {row.service_type && <div className="text-xs text-muted-foreground truncate">{row.service_type}</div>}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge className={red ? "border-0 bg-destructive/15 text-destructive" : "border-0 bg-amber-500/15 text-amber-600"}>
                    {row.completed_at ? `Completed ${formatDistanceToNowStrict(new Date(row.completed_at))} ago` : "Completed – date unknown"}
                  </Badge>
                  {row.quote_number && (
                    <span className="text-muted-foreground">{row.quote_number} · {formatRand(Number(row.quote_total || 0))}</span>
                  )}
                  {deposit && <span className="text-amber-600">Deposit {row.invoice_number} – balance due</span>}
                </div>
              </div>
              <Button
                size="sm"
                className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex-shrink-0"
                onClick={() => handleClick(row)}
              >
                <FilePlus className="h-3 w-3" />
                {deposit ? "Invoice balance" : "Create invoice"}
              </Button>
            </div>
          );
        })}
      </CardContent>
      {dialogRow && user && (
        <CreateInvoiceDialog
          open={!!dialogRow}
          onClose={() => {
            setDialogRow(null);
            refetch();
          }}
          agentId={user.id}
          prefillLead={{
            id: dialogRow.lead_id,
            customer_name: dialogRow.customer_name,
            customer_phone: dialogRow.customer_phone,
            customer_address: dialogRow.customer_address,
            customer_id: dialogRow.customer_id,
            service_type: dialogRow.service_type || undefined,
          }}
        />
      )}
    </Card>
  );
};

export default ReadyToInvoiceCard;

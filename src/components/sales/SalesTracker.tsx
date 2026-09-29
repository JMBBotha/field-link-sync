/**
 * "My commission" tracker (Job 5). Rows come from get_sales_tracker(): a rep sees only their own quotes,
 * the owner sees every rep (with a rep filter and "Mark paid out"), anyone else sees nothing.
 * Only sales figures are shown — no tech or company figures.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { formatRand } from "@/utils/formatRand";
import { formatSastDate, groupTracker, repsOf, type SalesTracker as Tracker, type TrackerRow } from "@/lib/salesTracker";

const money = (v: number | null | undefined) => formatRand(Number(v) || 0);

export default function SalesTracker() {
  const [repId, setRepId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["sales-tracker"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_sales_tracker", {});
      if (error) throw error;
      return (data ?? null) as Tracker | null;
    },
  });

  const setPaid = async (row: TrackerRow, paid: boolean) => {
    if (!row.snapshot_id) return;
    setBusy(row.snapshot_id);
    const { error } = await (supabase.rpc as any)("set_commission_paid", { p_snapshot_id: row.snapshot_id, p_paid: paid });
    setBusy(null);
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    toast({ title: paid ? "Marked paid out" : "Moved back to earned" });
    qc.invalidateQueries({ queryKey: ["sales-tracker"] });
    qc.invalidateQueries({ queryKey: ["owner-money-flow"] });
  };

  if (isLoading) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const rows = data?.rows ?? [];
  const owner = !!data?.is_owner;
  const reps = repsOf(rows);
  const groups = groupTracker(rows, repId || null);

  return (
    <div className="space-y-3" data-testid="sales-tracker">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground">{owner ? "Sales commission" : "My commission"}</h1>
          <p className="text-[11px] text-muted-foreground">
            Items profit ex VAT × your %. Earned is frozen when the job is fully paid{owner ? " · owner view: all reps" : ""}.
          </p>
        </div>
        {owner && reps.length > 0 && (
          <select value={repId} onChange={(e) => setRepId(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm" aria-label="Rep">
            <option value="">All reps</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {groups.map((g) => (
          <Card key={g.key} className="surface-card-solid">
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">{g.label} · {g.totals.count}</p>
              <p className="text-lg font-semibold text-foreground">{money(g.totals.commission)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No commission yet.</p>}

      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <Card key={g.key} className="surface-card-solid">
          <CardContent className="overflow-x-auto p-3">
            <h2 className="text-sm font-semibold text-foreground">{g.label} <span className="font-normal text-muted-foreground">· {g.hint}</span></h2>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">Quote</th>
                  {owner && <th className="pr-2">Rep</th>}
                  <th className="pr-2 text-right">Items sell</th>
                  <th className="pr-2 text-right">Items cost</th>
                  <th className="pr-2 text-right">Profit</th>
                  <th className="pr-2 text-right">%</th>
                  <th className="pr-2 text-right">Commission</th>
                  <th className="pr-2">{g.key === "paid_out" ? "Paid out" : g.key === "earned" ? "Fully paid" : ""}</th>
                  {owner && g.key !== "pipeline" && <th />}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.quote_id} className="border-t">
                    <td className="py-1 pr-2">
                      <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/admin/estimates/${r.quote_id}`)}>
                        {r.quote_number || "Quote"}
                      </button>
                      {r.unknown_cost_count > 0 && <span className="ml-1 text-amber-600">· {r.unknown_cost_count} uncosted</span>}
                      {g.key === "earned" && !r.frozen && <span className="ml-1 text-muted-foreground">· live, not frozen</span>}
                    </td>
                    {owner && <td className="pr-2">{r.rep_name || "Unknown"}</td>}
                    <td className="pr-2 text-right">{money(r.items_sell_ex_vat)}</td>
                    <td className="pr-2 text-right">{money(r.items_cost)}</td>
                    <td className="pr-2 text-right">{money(r.items_profit)}</td>
                    <td className="pr-2 text-right">{Number(r.percent) || 0}%</td>
                    <td className="pr-2 text-right font-medium">{money(r.commission)}</td>
                    <td className="pr-2">{formatSastDate(g.key === "paid_out" ? r.paid_at : r.invoice_paid_date)}</td>
                    {owner && g.key !== "pipeline" && (
                      <td className="text-right">
                        {r.snapshot_id && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy === r.snapshot_id}
                            onClick={() => setPaid(r, g.key === "earned")}>
                            {g.key === "earned" ? "Mark paid out" : "Undo"}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td className="py-1 pr-2">Total</td>
                  {owner && <td />}
                  <td className="pr-2 text-right">{money(g.totals.items_sell)}</td>
                  <td className="pr-2 text-right">{money(g.totals.items_cost)}</td>
                  <td className="pr-2 text-right">{money(g.totals.items_profit)}</td>
                  <td />
                  <td className="pr-2 text-right">{money(g.totals.commission)}</td>
                  <td />
                  {owner && g.key !== "pipeline" && <td />}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

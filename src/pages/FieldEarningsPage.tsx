/**
 * /field/earnings — tech "My earnings" (Job 6). Rows come from get_tech_earnings(): a tech sees only their own
 * paid-on-completion and holdback amounts; the owner sees every tech (tech filter + owner actions); anyone else nothing.
 * Tools share and company figures are never shown here. Phone-first: 44px (h-11) touch targets.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import FieldShell from "@/components/field/FieldShell";
import { formatRand } from "@/utils/formatRand";
import { formatSastDate } from "@/lib/salesTracker";
import {
  ACTION_LABEL, STATUS_INFO, actionsFor, netOf, summarize, techsOf,
  type TechAction, type TechEarningRow, type TechEarnings,
} from "@/lib/techEarnings";

const money = (v: number | null | undefined) => formatRand(Number(v) || 0);

function ReducePanel({ row, onDone }: { row: TechEarningRow; onDone: () => void }) {
  const [jobId, setJobId] = useState("");
  const [amount, setAmount] = useState(String(Number(row.amount) || 0));
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const { data: jobs } = useQuery({
    queryKey: ["callback-jobs", row.job_id],
    queryFn: async () => {
      const { data } = await (supabase.from("jobs") as any)
        .select("id, title, job_type, created_at").neq("id", row.job_id).order("created_at", { ascending: false }).limit(50);
      return (data ?? []) as { id: string; title: string | null; job_type: string | null; created_at: string }[];
    },
  });
  const submit = async () => {
    const n = Number(amount);
    if (!jobId || !(n >= 0 && n <= Number(row.amount))) {
      toast({ title: "Pick the callback job", description: `Reduction R0 – ${money(row.amount)}`, variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await (supabase.rpc as any)("set_tech_earning_status", {
      p_id: row.id, p_action: "reduce", p_callback_job_id: jobId, p_reduction: n,
    });
    setBusy(false);
    if (error) { toast({ title: "Could not reduce", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Holdback reduced" });
    onDone();
  };
  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Callback job"
        className="h-11 w-full rounded-md border bg-background px-2 text-sm">
        <option value="">Callback job…</option>
        {(jobs ?? []).map((j) => (
          <option key={j.id} value={j.id}>{(j.title || "Job").slice(0, 40)} · {j.job_type || ""} · {formatSastDate(j.created_at)}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <Input type="number" inputMode="decimal" min="0" max={Number(row.amount) || 0} step="0.01" value={amount}
          onChange={(e) => setAmount(e.target.value)} className="h-11" aria-label="Reduce by (R)" />
        <Button className="h-11" disabled={busy} onClick={submit}>Reduce</Button>
      </div>
    </div>
  );
}

export default function FieldEarningsPage() {
  const [techId, setTechId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reducing, setReducing] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["tech-earnings"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_tech_earnings", {});
      if (error) throw error;
      return (data ?? null) as TechEarnings | null;
    },
  });
  const refresh = () => {
    setReducing(null);
    qc.invalidateQueries({ queryKey: ["tech-earnings"] });
    qc.invalidateQueries({ queryKey: ["owner-money-flow"] });
  };
  const act = async (row: TechEarningRow, action: TechAction) => {
    if (action === "reduce") { setReducing(reducing === row.id ? null : row.id); return; }
    setBusy(row.id);
    const { error } = await (supabase.rpc as any)("set_tech_earning_status", { p_id: row.id, p_action: action });
    setBusy(null);
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    toast({ title: ACTION_LABEL[action] });
    refresh();
  };

  const rows = data?.rows ?? [];
  const owner = !!data?.is_owner;
  const techs = techsOf(rows);
  const sections = summarize(rows, techId || null);

  return (
    <FieldShell title={owner ? "Tech earnings" : "My earnings"}>
      <div className="space-y-3" data-testid="tech-earnings">
        <div>
          <p className="text-[11px] text-muted-foreground">
            Your share of labour (ex VAT): paid when the job is completed, plus a holdback released after the holdback period unless there is a callback.
          </p>
        </div>
        {owner && techs.length > 0 && (
          <select value={techId} onChange={(e) => setTechId(e.target.value)} aria-label="Tech"
            className="h-11 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">All techs</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {isLoading && <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>}

        {!isLoading && sections.map((s) => (
          <Card key={s.bucket} className="surface-card-solid">
            <CardContent className="p-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-foreground">{s.label}</h2>
                <span className="text-lg font-semibold tabular-nums">{money(s.total)}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {s.byStatus.map((b) => (
                  <div key={b.status} className="rounded-md border p-2">
                    <p className="text-[11px] text-muted-foreground">{b.label} · {b.count}</p>
                    <p className="text-sm font-semibold tabular-nums">{money(b.amount)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-2">
                {s.rows.map((r) => (
                  <div key={r.id ?? `${r.quote_id}-${r.tech_id}-${r.bucket}`} className="rounded-md border p-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{r.quote_number || "Job"}{owner && <span className="text-muted-foreground"> · {r.tech_name || "Unknown"}</span>}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {STATUS_INFO[r.status]?.label ?? r.status} · {Number(r.percent) || 0}%
                          {r.completed_at && ` · completed ${formatSastDate(r.completed_at)}`}
                          {r.bucket === "holdback" && r.release_after && ` · release from ${formatSastDate(r.release_after)}`}
                          {r.paid_at && ` · ${formatSastDate(r.paid_at)}`}
                          {Number(r.reduction_amount) > 0 && ` · reduced ${money(r.reduction_amount)}`}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums">{money(netOf(r))}</span>
                    </div>
                    {actionsFor(r, owner).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {actionsFor(r, owner).map((a) => (
                          <Button key={a} variant="outline" className="h-11 min-w-[44px]" disabled={busy === r.id} onClick={() => act(r, a)}>
                            {ACTION_LABEL[a]}
                          </Button>
                        ))}
                      </div>
                    )}
                    {reducing === r.id && <ReducePanel row={r} onDone={refresh} />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No earnings yet.</p>}
      </div>
    </FieldShell>
  );
}

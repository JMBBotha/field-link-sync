import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatRand } from "@/utils/formatRand";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
type Row = { company_id: string; company: string; is_master: boolean; plan_status: string; mandy_enabled: boolean; billing_live: boolean;
  grace_until: string | null; contract_signed_at: string | null; contract_ends_at: string | null; users: number; monthly_zar: number;
  commands_month: number; tts_calls_month: number; tts_chars_month: number };
const STATUS: Record<string, string> = { active: "Active", grace: "Grace (7 days)", suspended: "Paused", cancelled: "Cancelled", pending_contract: "Awaiting contract" };
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }) : "—");

/** Massair only: every company's plan, users, monthly price and assistant usage. Billing stays OFF. */
export default function AdminCompanyPlansPage({ rowsOverride }: { rowsOverride?: Row[] } = {}) {
  const { isMain, isLoading: mainLoading } = useIsMainCompany();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: fetched = [], isLoading } = useQuery({
    queryKey: ["plan-admin-overview"],
    enabled: isMain && !rowsOverride,
    queryFn: async () => { const { data, error } = await db.rpc("plan_admin_overview"); if (error) throw error; return (data || []) as Row[]; },
  });
  const rows = rowsOverride ?? fetched;
  const set = async (r: Row, status: string, mandy: boolean) => {
    const { error } = await db.rpc("plan_admin_set", { p_company: r.company_id, p_status: status, p_mandy_enabled: mandy });
    if (error) toast({ title: "Not changed", description: error.message, variant: "destructive" });
    else { toast({ title: `${r.company} updated` }); void qc.invalidateQueries({ queryKey: ["plan-admin-overview"] }); }
  };
  if (!rowsOverride && !mainLoading && !isMain) return <div className="p-6 text-sm text-muted-foreground">Company plans are managed by Massair.</div>;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" data-testid="company-plans">
      <div className="flex items-center gap-2"><Building2 className="h-5 w-5" /><h1 className="text-xl font-semibold">Company plans</h1></div>
      <p className="flex items-center gap-1.5 rounded-md bg-muted p-2 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Billing is OFF for every company. Nothing is charged. R4 500/month up to 3 users, R149 per extra user, 36-month contract, 7-day grace then paused.</p>
      {isLoading && !rowsOverride ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {rows.map((r) => (
        <Card key={r.company_id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{r.company}{r.is_master ? " (main)" : ""}</div>
              <div className="flex gap-1.5"><Badge variant={r.plan_status === "active" ? "secondary" : "destructive"}>{STATUS[r.plan_status] || r.plan_status}</Badge><Badge variant="outline">Billing off</Badge></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">Users</div>{r.users}</div>
              <div><div className="text-xs text-muted-foreground">Would be / month</div>{formatRand(Number(r.monthly_zar))}</div>
              <div><div className="text-xs text-muted-foreground">Assistant this month</div>{r.commands_month} commands · {r.tts_calls_month} spoken</div>
              <div><div className="text-xs text-muted-foreground">Contract</div>{r.contract_signed_at ? `Signed ${fmtDate(r.contract_signed_at)} · ends ${fmtDate(r.contract_ends_at)}` : "Not signed (existing company)"}</div>
            </div>
            {r.plan_status === "grace" && <p className="text-xs text-amber-600">Grace until {fmtDate(r.grace_until)}.</p>}
            {!r.is_master && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <label className="mr-auto flex items-center gap-2 text-sm"><Switch checked={r.mandy_enabled} onCheckedChange={(v) => set(r, r.plan_status, v)} /> Work assistant on</label>
                <Button size="sm" variant="outline" disabled={r.plan_status === "active"} onClick={() => set(r, "active", true)}>Active</Button>
                <Button size="sm" variant="outline" disabled={r.plan_status === "grace"} onClick={() => set(r, "grace", r.mandy_enabled)}>Start 7-day grace</Button>
                <Button size="sm" variant="destructive" disabled={r.plan_status === "suspended"} onClick={() => set(r, "suspended", false)}>Pause</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

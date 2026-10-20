import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { DEFAULT_LIMITS, LIMIT_LABELS, toLimits, type HbLimits } from "@/lib/salesHeartbeat";

/** Sales heartbeat stall limits (company_settings.sales_stage_limits). Nudges are in-app / push only. */
export default function SalesStageLimitsCard() {
  const { companyId } = useUserCompanyId() as any;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sales-stage-limits", companyId], enabled: !!companyId,
    queryFn: async () => { const { data } = await (supabase.from("company_settings") as any).select("sales_stage_limits").eq("company_id", companyId).maybeSingle(); return toLimits(data?.sales_stage_limits); },
  });
  const [f, setF] = useState<HbLimits>(DEFAULT_LIMITS);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);
  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from("company_settings") as any).update({ sales_stage_limits: f }).eq("company_id", companyId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Heartbeat limits saved"); qc.invalidateQueries({ queryKey: ["sales-stage-limits"] }); qc.invalidateQueries({ queryKey: ["company-settings"] });
  };
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2"><CardTitle className="text-base">Sales heartbeat: when a stage counts as stalled</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">Past each limit the item turns red and the named people get an in-app nudge (logged once per step). New-lead limits only run in business hours.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {LIMIT_LABELS.map((l) => (
            <label key={l.key} className="flex items-center justify-between gap-2"><span>{l.label}</span>
              <span className="flex items-center gap-1"><Input type="number" min={1} value={f[l.key]} onChange={(e) => setF({ ...f, [l.key]: Math.max(1, Number(e.target.value) || DEFAULT_LIMITS[l.key]) })} className="h-8 w-20" /><span className="w-8 text-muted-foreground">{l.unit}</span></span>
            </label>))}
        </div>
        <Button size="sm" onClick={save} disabled={saving || !companyId}>Save limits</Button>
      </CardContent>
    </Card>
  );
}

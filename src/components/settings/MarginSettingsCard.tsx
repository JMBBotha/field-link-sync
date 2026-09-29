import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/** Admin-only: labour cost rate, GP target and independent role earnings shares. */
export default function MarginSettingsCard() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["margin-settings", user?.id],
    enabled: !!user?.id && !!isAdmin,
    queryFn: async () => {
      const { data: p } = await (supabase.from("profiles") as any).select("company_id").eq("id", user!.id).maybeSingle();
      if (!p?.company_id) return null;
      const { data: rows, error } = await (supabase.rpc as any)("get_company_margin_settings", { p_company_id: p.company_id });
      if (error) throw error;
      const c = Array.isArray(rows) ? rows[0] : rows;
      return c ? { ...c, id: c.company_id } : null;
    },
  });
  const [labour, setLabour] = useState(""); const [target, setTarget] = useState("20"); const [comm, setComm] = useState("50");
  const [labourShare, setLabourShare] = useState("60");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    setLabour(data.labour_cost_per_hour == null ? "" : String(data.labour_cost_per_hour));
    setTarget(String(data.gp_target_percent ?? 20)); setComm(String(data.sales_commission_percent ?? 50));
    setLabourShare(String(data.labour_tech_share_percent ?? 60));
  }, [data]);
  if (!isAdmin || !data) return null;

  const save = async () => {
    const t = Number(target), c = Number(comm), ls = Number(labourShare), l = labour.trim() === "" ? null : Number(labour);
    if (!(t >= 0 && t < 100) || !(c >= 0 && c <= 100) || !(ls >= 0 && ls <= 100) || (l != null && !(l >= 0))) {
      toast({ title: "Check the numbers", description: "Target 0–99%, earnings shares 0–100%, labour cost R0 or more.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from("companies") as any)
      .update({ labour_cost_per_hour: l, gp_target_percent: t, sales_commission_percent: c, labour_tech_share_percent: ls }).eq("id", data.id);
    setSaving(false);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Profit settings saved" });
    qc.invalidateQueries({ queryKey: ["margin-settings"] }); qc.invalidateQueries({ queryKey: ["margin-view"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales &amp; tech earnings (staff only)</CardTitle>
        <p className="text-sm text-muted-foreground">Sales earns on parts &amp; materials profit only. Technicians earn on labour only.</p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <div><Label>Labour cost per hour (R, what it costs you)</Label>
          <Input type="number" min="0" step="0.01" placeholder="Not set" value={labour} onChange={(e) => setLabour(e.target.value)} /></div>
        <div><Label>GP target %</Label>
          <Input type="number" min="0" max="99" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div><Label>Salesperson share of profit on parts &amp; materials (%)</Label>
          <Input type="number" min="0" max="100" value={comm} onChange={(e) => setComm(e.target.value)} /></div>
        <div><Label>Technician share of labour (%)</Label>
          <Input type="number" min="0" max="100" value={labourShare} onChange={(e) => setLabourShare(e.target.value)} /></div>
        <div className="md:col-span-4 flex justify-end"><Button onClick={save} disabled={saving}>Save profit settings</Button></div>
      </CardContent>
    </Card>
  );
}

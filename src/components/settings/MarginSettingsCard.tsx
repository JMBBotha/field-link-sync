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

/** Admin-only: labour cost rate, GP target, sales share and tech pay split (paid on completion / holdback / tools). */
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
  // Tech pay (Job 6): % of labour sell ex VAT. Saved through set_company_tech_pay_settings (admin/owner only, server-checked).
  const [paidPct, setPaidPct] = useState("40"); const [heldPct, setHeldPct] = useState("10");
  const [heldDays, setHeldDays] = useState("45"); const [toolsPct, setToolsPct] = useState("10");
  const { data: techPay } = useQuery({
    queryKey: ["tech-pay-settings", data?.id],
    enabled: !!data?.id,
    queryFn: async () => {
      const { data: t, error } = await (supabase.rpc as any)("get_company_tech_pay_settings", { p_company_id: data!.id });
      if (error) throw error;
      return t as { tech_paid_on_completion_pct: number; tech_holdback_pct: number; tech_holdback_days: number; tools_retained_pct: number } | null;
    },
  });
  useEffect(() => {
    if (!techPay) return;
    setPaidPct(String(techPay.tech_paid_on_completion_pct)); setHeldPct(String(techPay.tech_holdback_pct));
    setHeldDays(String(techPay.tech_holdback_days)); setToolsPct(String(techPay.tools_retained_pct));
  }, [techPay]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    setLabour(data.labour_cost_per_hour == null ? "" : String(data.labour_cost_per_hour));
    setTarget(String(data.gp_target_percent ?? 20)); setComm(String(data.sales_commission_percent ?? 50));
  }, [data]);
  if (!isAdmin || !data) return null;

  const save = async () => {
    const t = Number(target), c = Number(comm), l = labour.trim() === "" ? null : Number(labour);
    const pp = Number(paidPct), hp = Number(heldPct), hd = Number(heldDays), tp = Number(toolsPct);
    const techOk = [pp, hp, tp].every((x) => x >= 0 && x <= 100) && pp + hp + tp <= 100 && Number.isInteger(hd) && hd >= 0 && hd <= 3650;
    if (!(t >= 0 && t < 100) || !(c >= 0 && c <= 100) || !techOk || (l != null && !(l >= 0))) {
      toast({ title: "Check the numbers", description: "Target 0–99%, sales share 0–100%, tech paid + held + tools 100% or less, holdback days 0–3650, labour cost R0 or more.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from("companies") as any)
      .update({ labour_cost_per_hour: l, gp_target_percent: t, sales_commission_percent: c }).eq("id", data.id);
    const { error: techErr } = error ? { error: null } : await (supabase.rpc as any)("set_company_tech_pay_settings", {
      p_company_id: data.id, p_paid_pct: pp, p_holdback_pct: hp, p_holdback_days: hd, p_tools_pct: tp,
    });
    setSaving(false);
    if (error || techErr) { toast({ title: "Couldn't save", description: (error || techErr).message, variant: "destructive" }); return; }
    toast({ title: "Profit settings saved" });
    qc.invalidateQueries({ queryKey: ["margin-settings"] }); qc.invalidateQueries({ queryKey: ["margin-view"] });
    qc.invalidateQueries({ queryKey: ["tech-pay-settings"] }); qc.invalidateQueries({ queryKey: ["my-earnings"] });
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
        <div><Label>Tech paid on job completion (% of labour)</Label>
          <Input type="number" min="0" max="100" value={paidPct} onChange={(e) => setPaidPct(e.target.value)} /></div>
        <div><Label>Tech holdback (% of labour)</Label>
          <Input type="number" min="0" max="100" value={heldPct} onChange={(e) => setHeldPct(e.target.value)} /></div>
        <div><Label>Holdback released after (days, unless a callback)</Label>
          <Input type="number" min="0" max="3650" step="1" value={heldDays} onChange={(e) => setHeldDays(e.target.value)} /></div>
        <div><Label>Tools share kept by company (% of labour)</Label>
          <Input type="number" min="0" max="100" value={toolsPct} onChange={(e) => setToolsPct(e.target.value)} /></div>
        <p className="md:col-span-4 text-[11px] text-muted-foreground">
          Company keeps {Math.max(0, 100 - (Number(paidPct) || 0) - (Number(heldPct) || 0))}% of labour (incl. the {Number(toolsPct) || 0}% tools share).
        </p>
        <div className="md:col-span-4 flex justify-end"><Button onClick={save} disabled={saving}>Save profit settings</Button></div>
      </CardContent>
    </Card>
  );
}

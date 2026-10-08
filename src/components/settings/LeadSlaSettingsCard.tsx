import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useLeadSla } from "@/hooks/useLeadSla";
import { cn } from "@/lib/utils";
import { TimeInput24 } from "@/components/ui/time-input-24";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Admin: business hours + lead clock targets (public.lead_sla_settings; RLS lets company admins write). */
export default function LeadSlaSettingsCard() {
  const { sla, row } = useLeadSla();
  const { companyId } = useUserCompanyId() as any;
  const qc = useQueryClient();
  const [f, setF] = useState(sla);
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(sla), [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const cid = row?.company_id || companyId;
    if (!cid) { toast.error("No company found for your profile"); return; }
    setSaving(true);
    const { error } = await (supabase.from("lead_sla_settings" as any) as any).upsert({
      company_id: cid, enabled: f.enabled, contact_minutes: f.contactMinutes, work_days: f.workDays,
      open_time: f.open, close_time: f.close, quote_amber_time: f.amber, updated_at: new Date().toISOString(),
    }, { onConflict: "company_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Lead clock settings saved");
    qc.invalidateQueries({ queryKey: ["lead-sla-settings"] });
  };
  const time = (k: "open" | "close" | "amber", label: string) => (
    <div className="space-y-1"><Label className="text-xs">{label}</Label>
      <TimeInput24 value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="h-8" /></div>
  );
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2"><CardTitle className="text-base">Lead clocks and business hours</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2"><Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} /><span>Clocks and owner alerts on</span></div>
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d, i) => {
            const n = i + 1, on = f.workDays.includes(n);
            return <button key={d} type="button" onClick={() => setF({ ...f, workDays: on ? f.workDays.filter((x) => x !== n) : [...f.workDays, n].sort() })}
              className={cn("rounded-md border px-2 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{d}</button>;
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {time("open", "Opens")}{time("close", "Closes (quote due)")}{time("amber", "Quote amber from")}
          <div className="space-y-1"><Label className="text-xs">Contact within (min)</Label>
            <Input type="number" min={1} max={240} value={f.contactMinutes} onChange={(e) => setF({ ...f, contactMinutes: Math.max(1, Number(e.target.value) || 5) })} className="h-8" /></div>
        </div>
        <p className="text-xs text-muted-foreground">Leads that arrive after hours start their clock at the next opening. An unanswered call is logged as an attempt and does not stop the clock.</p>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </CardContent>
    </Card>
  );
}

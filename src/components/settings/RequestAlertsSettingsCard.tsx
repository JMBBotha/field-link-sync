import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { DEFAULT_REQUEST_ALERTS, type RequestAlertSettings } from "@/lib/requestOffers";

type Props = { value?: RequestAlertSettings; onSave?: (v: RequestAlertSettings) => Promise<void> | void };

/** Presentational (also used by the screenshot harness). Hours/days shown; stored as working minutes. */
export function RequestAlertsSettingsView({ value = DEFAULT_REQUEST_ALERTS, onSave }: Props) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const h = (m: number) => Math.round((m / 60) * 10) / 10;
  return (
    <Card className="mt-4" data-testid="request-alert-settings">
      <CardHeader className="pb-2"><CardTitle className="text-base">Requests: in-app alerts</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Working time only (Mon–Fri 08:00–17:00). Alerts go to the bell of the assigned person and every admin and owner; Move requests also alert the client's own rep. Each alert fires once.</p>
        <label className="flex min-h-11 items-center justify-between gap-2"><span className="font-medium">Alerts on</span>
          <Switch checked={v.enabled} onCheckedChange={(c) => setV({ ...v, enabled: c })} data-testid="ra-enabled" /></label>
        <label className="flex flex-wrap items-center gap-2"><span className="w-full font-medium sm:w-56">Not contacted after</span>
          <Input type="number" min={0.25} max={90} step={0.25} value={h(v.contact_limit_wmin)} onChange={(e) => setV({ ...v, contact_limit_wmin: Math.round(Number(e.target.value) * 60) })} className="h-11 w-24" data-testid="ra-contact" />
          <span className="text-muted-foreground">working hours</span></label>
        <label className="flex flex-wrap items-center gap-2"><span className="w-full font-medium sm:w-56">Service / Move with no date after</span>
          <Input type="number" min={1} max={180} value={h(v.unscheduled_limit_wmin)} onChange={(e) => setV({ ...v, unscheduled_limit_wmin: Math.round(Number(e.target.value) * 60) })} className="h-11 w-24" data-testid="ra-unscheduled" />
          <span className="text-muted-foreground">working hours</span></label>
        <label className="flex flex-wrap items-center gap-2"><span className="w-full font-medium sm:w-56">Admin task overdue by</span>
          <Input type="number" min={0} max={10} value={v.task_overdue_wdays} onChange={(e) => setV({ ...v, task_overdue_wdays: Math.max(0, Math.min(10, Math.round(Number(e.target.value)))) })} className="h-11 w-24" data-testid="ra-task" />
          <span className="text-muted-foreground">working days</span></label>
        <Button className="fl-btn-primary min-h-11" onClick={() => onSave?.(v)}>Save</Button>
      </CardContent>
    </Card>
  );
}

export default function RequestAlertsSettingsCard() {
  const { companyId } = useUserCompanyId() as any;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["request-alert-settings", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("request_alert_settings").select("*").eq("company_id", companyId).maybeSingle();
      return { ...DEFAULT_REQUEST_ALERTS, ...(data || {}) } as RequestAlertSettings;
    },
  });
  return <RequestAlertsSettingsView value={data} onSave={async (v) => {
    const { error } = await supabase.from("request_alert_settings").upsert({ company_id: companyId, ...v, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
    if (error) return void toast.error(error.message);
    toast.success("Request alerts saved"); qc.invalidateQueries({ queryKey: ["request-alert-settings"] });
  }} />;
}

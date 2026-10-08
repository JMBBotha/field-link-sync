import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import AddressMapField from "@/components/entity/AddressMapField";
import { hhmm } from "@/lib/schedulingDefaults";
import { TimeInput24 } from "@/components/ui/time-input-24";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Company working days/hours and office base. */
export default function CompanyWorkHoursCard() {
  const { companyId } = useUserCompanyId();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const [office, setOffice] = useState<{ address: string | null; lat: number | null; lng: number | null }>({ address: null, lat: null, lng: null });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    supabase.from("companies").select("work_days, work_start, work_end, office_address, office_lat, office_lng").eq("id", companyId).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setDays(data.work_days || []); setStart(hhmm(data.work_start)); setEnd(hhmm(data.work_end));
        setOffice({ address: data.office_address, lat: data.office_lat, lng: data.office_lng });
      });
  }, [companyId]);

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    const { error } = await supabase.from("companies").update({ work_days: [...days].sort(), work_start: start, work_end: end, office_address: office.address, office_lat: office.lat, office_lng: office.lng }).eq("id", companyId);
    setSaving(false);
    toast(error ? { title: "Save failed", description: error.message, variant: "destructive" } : { title: "Working hours saved" });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2"><CardTitle className="text-base">Working hours &amp; office</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1 text-sm">
            <Checkbox checked={days.includes(i)} onCheckedChange={(v) => setDays((p) => v ? [...p.filter((x) => x !== i), i] : p.filter((x) => x !== i))} />{d}
          </label>
        ))}</div>
        <div className="flex items-center gap-2">
          <TimeInput24 value={start} onChange={(e) => setStart(e.target.value)} className="w-28" />
          <span className="text-xs text-muted-foreground">to</span>
          <TimeInput24 value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" />
        </div>
        <AddressMapField label="Office address" value={office.address} lat={office.lat} lng={office.lng} onSave={async (v) => setOffice(v)} />
        <Button onClick={save} disabled={saving || !companyId}>Save</Button>
      </CardContent>
    </Card>
  );
}

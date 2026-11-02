import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { clampInt, DEFAULT_LEAD_OFFERS, OFFER_LIMITS, type LeadOfferSettings } from "@/lib/requestOffers";

const FIELDS: { key: keyof typeof OFFER_LIMITS; label: string; unit: string }[] = [
  { key: "first_wave", label: "First offer goes to", unit: "best-ranked reps" },
  { key: "first_window_min", label: "Widen after", unit: "min" },
  { key: "widen_every_min", label: "Then widen every", unit: "min" },
  { key: "widen_by", label: "Add each time", unit: "reps" },
  { key: "escalate_after_min", label: "Alert the owner after", unit: "min if nobody accepts" },
];

type Props = { value?: LeadOfferSettings; onSave?: (v: LeadOfferSettings) => Promise<void> | void };

export function LeadOfferSettingsView({ value = DEFAULT_LEAD_OFFERS, onSave }: Props) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Card className="mt-4" data-testid="lead-offer-settings">
      <CardHeader className="pb-2"><CardTitle className="text-base">New sale offers to reps</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">New sale requests are offered to sales reps ranked by availability, then distance, then skills, then workload. Before accepting, reps see only the job type and rough area. The first rep to accept gets it.</p>
        <label className="flex min-h-11 items-center justify-between gap-2"><span className="font-medium">Offers on <span className="text-muted-foreground font-normal">(off by default; only new requests after switching on)</span></span>
          <Switch checked={v.enabled} onCheckedChange={(c) => setV({ ...v, enabled: c })} data-testid="lo-enabled" /></label>
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-wrap items-center gap-2">
            <span className="w-full font-medium sm:w-56">{f.label}</span>
            <Input type="number" min={OFFER_LIMITS[f.key][0]} max={OFFER_LIMITS[f.key][1]} value={v[f.key]}
              onChange={(e) => setV({ ...v, [f.key]: clampInt(e.target.value, OFFER_LIMITS[f.key]) })} className="h-11 w-20" data-testid={`lo-${f.key}`} />
            <span className="text-muted-foreground">{f.unit}</span>
          </label>
        ))}
        <Button className="fl-btn-primary min-h-11" onClick={() => onSave?.(v)}>Save</Button>
      </CardContent>
    </Card>
  );
}

export default function LeadOfferSettingsCard() {
  const { companyId } = useUserCompanyId() as any;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["lead-offer-settings", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase.from("lead_offer_settings" as any) as any).select("*").eq("company_id", companyId).maybeSingle();
      return { ...DEFAULT_LEAD_OFFERS, ...(data || {}) } as LeadOfferSettings;
    },
  });
  return <LeadOfferSettingsView value={data} onSave={async (v) => {
    const { error } = await (supabase.from("lead_offer_settings" as any) as any).upsert({ company_id: companyId, ...v, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
    if (error) return void toast.error(error.message);
    toast.success("Offer settings saved"); qc.invalidateQueries({ queryKey: ["lead-offer-settings"] });
  }} />;
}

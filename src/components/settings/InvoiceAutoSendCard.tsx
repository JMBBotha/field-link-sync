import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { DEFAULT_AUTO_SEND_MINUTES } from "@/lib/invoiceSendApproval";

export const clampMinutes = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(1440, Math.max(0, n)) : DEFAULT_AUTO_SEND_MINUTES;
};

/** company_settings.invoice_auto_send_minutes: how long after a quote is accepted the deposit invoice auto-sends. 0 = never. */
export default function InvoiceAutoSendCard() {
  const { companyId } = useUserCompanyId() as any;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["invoice-auto-send-minutes", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase.from("company_settings") as any).select("invoice_auto_send_minutes").eq("company_id", companyId).maybeSingle();
      return data?.invoice_auto_send_minutes ?? DEFAULT_AUTO_SEND_MINUTES;
    },
  });
  const [m, setM] = useState<number>(DEFAULT_AUTO_SEND_MINUTES);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data !== undefined) setM(data); }, [data]);
  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from("company_settings") as any).update({ invoice_auto_send_minutes: clampMinutes(m) }).eq("company_id", companyId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Invoice auto-send saved"); qc.invalidateQueries({ queryKey: ["invoice-auto-send-minutes"] });
  };
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2"><CardTitle className="text-base">Accepted quotes: send the deposit invoice</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">When a quote is accepted, the rep and admins get an alert with Send invoice now / Edit / Hold. If nobody acts, the deposit invoice emails to the client after this many minutes. 0 = never auto-send.</p>
        <label className="flex items-center gap-2"><span>Auto-send after</span>
          <Input type="number" min={0} max={1440} value={m} onChange={(e) => setM(clampMinutes(e.target.value))} className="h-8 w-20" data-testid="invoice-auto-send-minutes" />
          <span className="text-muted-foreground">min</span></label>
        <Button size="sm" onClick={save} disabled={saving || !companyId}>Save</Button>
      </CardContent>
    </Card>
  );
}

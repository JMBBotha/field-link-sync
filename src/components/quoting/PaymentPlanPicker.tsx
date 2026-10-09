import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLAN_PRESETS, isValidPlan, parsePlan, planSummary, type PaymentPlan } from "@/lib/paymentPlans";

/**
 * Accounting step 1: choose how a quote is paid (e.g. 70/30, 65/35, 20/60/20).
 * Locked once any invoice exists for the quote. Office and the quote's own salesperson only (page-level).
 */
export default function PaymentPlanPicker({ quoteId }: { quoteId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { settings } = useCompanySettings();
  const defPct = Number(settings?.default_deposit_percentage) || 70;
  const { data } = useQuery({
    queryKey: ["quote-payment-plan", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const [{ data: q }, { count }] = await Promise.all([
        (supabase.from("quotes") as any).select("payment_plan").eq("id", quoteId).maybeSingle(),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("quote_id", quoteId),
      ]);
      return { plan: (isValidPlan(q?.payment_plan) ? q.payment_plan : null) as PaymentPlan | null, invoiced: (count ?? 0) > 0 };
    },
  });
  const plan = data?.plan ?? null;
  const locked = !!data?.invoiced;
  const isPreset = !plan || PLAN_PRESETS.some((p) => p.name === plan.name);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const value = customOpen ? "custom" : plan ? (isPreset ? plan.name : "custom") : "default";
  const customPlan = parsePlan(customText);

  const onPick = (v: string) => {
    if (v === "custom") { setCustomText(plan && !isPreset ? plan.name : ""); setCustomOpen(true); return; }
    setCustomOpen(false);
    void save(v === "default" ? null : PLAN_PRESETS.find((p) => p.name === v) ?? null);
  };

  const save = async (next: PaymentPlan | null) => {
    const { data: rows, error } = await (supabase.from("quotes") as any).update({ payment_plan: next }).eq("id", quoteId).select("id");
    if (error || !rows?.length) { toast({ title: "Could not save the payment plan", description: error?.message || "No permission", variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["quote-payment-plan", quoteId] });
    qc.invalidateQueries({ queryKey: ["accepted-work-quote", quoteId] });
    setCustomOpen(false);
    toast({ title: "Payment plan saved", description: planSummary(next, defPct) });
  };

  return (
    <div data-testid="payment-plan" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm print:hidden">
      <CalendarClock className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">Payment plan</span>
      {locked ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title="Invoices already exist for this quote">
          <Lock className="h-3.5 w-3.5" /> {planSummary(plan, defPct)}
        </span>
      ) : (
        <>
          <Select value={value} onValueChange={onPick}>
            <SelectTrigger className="h-8 w-[200px] bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Standard ({defPct}/{100 - defPct})</SelectItem>
              {PLAN_PRESETS.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
              <SelectItem value="custom">{plan && !isPreset ? `Custom (${plan.name})` : "Custom split…"}</SelectItem>
            </SelectContent>
          </Select>
          {customOpen ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Input data-testid="custom-split" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="e.g. 40/40/20"
                className="h-8 w-[120px] bg-background" inputMode="numeric" />
              <Button size="sm" className="h-8" disabled={!customPlan} onClick={() => customPlan && save(customPlan)}>Save</Button>
              <span className={customPlan || !customText ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                {customPlan ? planSummary(customPlan) : customText ? "2–4 parts that add up to 100" : "2–4 parts, adding up to 100"}
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{planSummary(plan, defPct)}</span>
          )}
        </>
      )}
    </div>
  );
}

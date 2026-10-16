import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isValidPlan } from "@/lib/paymentPlans";

/** Johan 00:08: the stacked quote settings rows live in ONE collapsible panel at the bottom (collapsed by default).
 *  Children stay mounted while collapsed so background work (unit-card content fetch etc.) behaves exactly as before. */
export function quoteSettingsSummary(o: { status?: string | null; plan?: string | null; unitCards?: boolean; note?: string | null }) {
  const st = String(o.status || "draft");
  return [st.charAt(0).toUpperCase() + st.slice(1), o.plan || "Default plan", `Unit cards ${o.unitCards === false ? "off" : "on"}`, o.note && o.note.trim() ? "note added" : "no note"].join(" · ");
}

export default function QuoteSettingsPanel({ quoteId, status, unitCards, note, children }: { quoteId: string; status?: string | null; unitCards?: boolean; note?: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("settings") === "1");
  const { data: plan } = useQuery({
    queryKey: ["quote-payment-plan-name", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data } = await (supabase.from("quotes") as any).select("payment_plan").eq("id", quoteId).maybeSingle();
      return isValidPlan(data?.payment_plan) ? (data.payment_plan.name as string) : null;
    },
  });
  return (
    <section id="quote-settings" className="rounded-lg border border-border bg-card print:hidden" data-pdf-hide data-html2canvas-ignore data-testid="quote-settings-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="quote-settings-body" className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-semibold">Quote settings &amp; notes</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="quote-settings-summary">{quoteSettingsSummary({ status, plan, unitCards, note })}</span>
        <ChevronDown className={"h-4 w-4 shrink-0 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      <div id="quote-settings-body" className={open ? "space-y-3 border-t border-border p-3" : "hidden"}>{children}</div>
    </section>
  );
}

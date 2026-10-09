import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { FLAG_LABEL, type LeadOfferFlag } from "@/lib/leadOffers";

/** Admin/office: unassigned sales leads no salesperson is being offered (e.g. "Needs appointment time"). */
export default function LeadOfferFlagsCard() {
  const { data } = useQuery({
    queryKey: ["lead-offer-flags"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_lead_offer_flags");
      if (error) throw error;
      return (data ?? []) as LeadOfferFlag[];
    },
  });
  if (!data || data.length === 0) return null;
  return (
    <Card className="surface-card border-amber-500/40" data-testid="lead-offer-flags">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Leads not offered to sales ({data.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {data.map((f, i) => (
          <div key={`${f.lead_id ?? "rep"}-${i}`} className="flex flex-wrap items-center gap-2 text-sm min-h-[36px]" data-testid="lead-offer-flag">
            <Badge variant="outline" className="text-[10px] border-amber-500/60">{FLAG_LABEL[f.issue] ?? f.issue}</Badge>
            {f.lead_id ? (
              <Link to={`/admin/dispatch?lead=${f.lead_id}`} className="font-medium text-primary hover:underline">{f.customer_name || "Lead"}</Link>
            ) : (
              <span className="font-medium">{f.customer_name}</span>
            )}
            {f.issue !== "needs_time" && f.detail && <span className="text-xs text-muted-foreground w-full">{f.detail}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

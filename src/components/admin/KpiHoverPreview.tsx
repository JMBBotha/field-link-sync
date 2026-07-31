import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { format } from "date-fns";

export interface PreviewRow {
  id: string;
  primary: string;
  secondary: string;
  badge?: string;
  value?: string;
  href: string;
}

async function fetchPreview(kpiKey: string, today: string): Promise<PreviewRow[]> {
  const leadHref = (l: { id: string; customer_id?: string | null }) =>
    l.customer_id ? `/admin/customers/${l.customer_id}` : `/admin/dispatch`;

  switch (kpiKey) {
    case "new_leads":
    case "active_jobs": {
      const query = supabase
        .from("leads")
        .select("id, customer_name, customer_address, service_type, status, customer_id, created_at, customer_phone");
      const { data } =
        kpiKey === "new_leads"
          ? await query
              .gte("created_at", today + "T00:00:00")
              .eq("status", "pending")
              .order("created_at", { ascending: false })
              .limit(5)
          : await query.in("status", ["accepted", "en_route", "on_site"]).limit(5);

      return (data || []).map((l: any) => ({
        id: l.id,
        primary: l.customer_name || "Unknown",
        secondary: [l.service_type, l.customer_phone, l.customer_address].filter(Boolean).join(" • "),
        badge: (l.status || "").replace(/_/g, " "),
        href: leadHref(l),
      }));
    }
    case "pending_quotes": {
      const { data } = await supabase
        .from("quotes")
        .select("id, quote_number, total, created_at, customer_id, customers(name)")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(5);
      return (data || []).map((q: any) => ({
        id: q.id,
        primary: q.customers?.name || q.quote_number,
        secondary: `${q.quote_number} • ${q.created_at ? format(new Date(q.created_at), "dd MMM HH:mm") : ""}`,
        value: `R ${Number(q.total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        href: q.customer_id ? `/admin/customers/${q.customer_id}` : "/admin/quotes",
      }));
    }
    case "overdue_invoices": {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, grand_total, due_date, customer_id")
        .eq("status", "overdue")
        .order("due_date", { ascending: true })
        .limit(5);
      return (data || []).map((inv: any) => ({
        id: inv.id,
        primary: inv.customer_name || inv.invoice_number,
        secondary: `${inv.invoice_number} • Due ${inv.due_date ? format(new Date(inv.due_date), "dd MMM") : "N/A"}`,
        value: `R ${Number(inv.grand_total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        badge: "overdue",
        href: inv.customer_id ? `/admin/customers/${inv.customer_id}` : "/admin/invoices",
      }));
    }
    case "active_techs": {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, availability_status, phone")
        .limit(5);
      return (data || []).map((p: any) => ({
        id: p.id,
        primary: p.full_name || "Unnamed technician",
        secondary: [p.phone, p.availability_status].filter(Boolean).join(" • "),
        badge: p.availability_status || undefined,
        href: "/admin/team",
      }));
    }
    default:
      return [];
  }
}

interface Props {
  kpiKey: string;
  label: string;
  viewAllHref: string;
  children: React.ReactNode;
}

/**
 * Hover preview for the dashboard KPI cards — shows the first few underlying
 * records with basic info; clicking a row navigates to that client/record.
 */
const KpiHoverPreview = ({ kpiKey, label, viewAllHref, children }: Props) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["kpi-preview", kpiKey, today],
    queryFn: () => fetchPreview(kpiKey, today),
    enabled: open,
    staleTime: 30000,
  });

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0 overflow-hidden">
        <div className="px-3 py-2 border-b bg-muted/40">
          <p className="text-xs font-semibold">{label}</p>
          <p className="text-[11px] text-muted-foreground">Click an item to open its record</p>
        </div>

        <div className="max-h-72 overflow-y-auto divide-y">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : !data || data.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">Nothing to show right now</p>
          ) : (
            data.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(row.href);
                }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/60 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{row.primary}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{row.secondary}</p>
                </div>
                {row.value && <span className="text-[11px] font-mono tabular-nums shrink-0">{row.value}</span>}
                {row.badge && (
                  <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                    {row.badge}
                  </Badge>
                )}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate(viewAllHref);
          }}
          className="w-full px-3 py-2 text-xs font-medium text-primary hover:bg-muted/60 border-t text-left"
        >
          View all →
        </button>
      </HoverCardContent>
    </HoverCard>
  );
};

export default KpiHoverPreview;

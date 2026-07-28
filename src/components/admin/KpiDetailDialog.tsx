import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { type LucideIcon } from "lucide-react";

interface KpiDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kpiKey: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

const KpiDetailDialog = ({ open, onOpenChange, kpiKey, label, icon: Icon, color }: KpiDetailDialogProps) => {
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["kpi-detail", kpiKey],
    queryFn: () => fetchDetail(kpiKey, today),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-background/95 backdrop-blur-md dark:bg-[#070e1a]/95 dark:border-blue-400/20">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${color}`} />
            {label}
          </DialogTitle>
          <DialogDescription>Detailed breakdown for today</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg dark:bg-slate-700/30" />
              ))
            : data?.length === 0
              ? <p className="text-sm text-muted-foreground text-center py-8">No records found</p>
              : data?.map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50 dark:border-blue-400/10 dark:hover:bg-blue-900/20"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{row.primary}</p>
                      <p className="text-xs text-muted-foreground truncate">{row.secondary}</p>
                    </div>
                    {row.badge && (
                      <Badge variant={row.badgeVariant === "destructive" ? "destructive" : "secondary"} className="shrink-0 ml-2">
                        {row.badge}
                      </Badge>
                    )}
                    {row.value && (
                      <span className="text-sm font-mono font-medium tabular-nums ml-2 shrink-0">{row.value}</span>
                    )}
                  </div>
                ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface DetailRow {
  primary: string;
  secondary: string;
  badge?: string;
  badgeVariant?: string;
  value?: string;
}

async function fetchDetail(kpiKey: string, today: string): Promise<DetailRow[]> {
  switch (kpiKey) {
    case "new_leads": {
      const { data } = await supabase
        .from("leads")
        .select("id, customer_name, customer_address, service_type, status")
        .gte("created_at", today + "T00:00:00")
        .eq("status", "pending")
        .limit(50);
      return (data || []).map((l) => ({
        primary: l.customer_name,
        secondary: `${l.service_type} • ${l.customer_address}`,
        badge: l.status,
      }));
    }
    case "pending_quotes": {
      const { data } = await supabase
        .from("quotes")
        .select("id, quote_number, total, created_at, customers(name)")
        .eq("status", "draft")
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(50);

      return (data || []).map((q) => {
        const custName = (q.customers as any)?.name || q.quote_number;
        return {
          primary: custName,
          secondary: `${q.quote_number} • ${format(new Date(q.created_at), "dd MMM HH:mm")}`,
          value: `R ${Number(q.total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        };
      });
    }
    case "active_jobs": {
      const { data } = await supabase
        .from("leads")
        .select("id, customer_name, customer_address, service_type, status, assigned_agent_id")
        .in("status", ["accepted", "en_route", "on_site"])
        .limit(50);
      return (data || []).map((l) => ({
        primary: l.customer_name,
        secondary: `${l.service_type} • ${l.customer_address}`,
        badge: l.status,
        badgeVariant: l.status === "on_site" ? "default" : "secondary",
      }));
    }
    case "overdue_invoices": {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, grand_total, due_date")
        .eq("status", "overdue")
        .order("due_date", { ascending: true })
        .limit(50);
      return (data || []).map((inv) => ({
        primary: inv.customer_name,
        secondary: `${inv.invoice_number} • Due ${inv.due_date ? format(new Date(inv.due_date), "dd MMM") : "N/A"}`,
        value: `R ${Number(inv.grand_total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        badge: "overdue",
        badgeVariant: "destructive",
      }));
    }
    case "overdue_maintenance": {
      const { data } = await supabase
        .from("maintenance_schedules")
        .select("id, due_date, status, customer_id, notes")
        .eq("status", "pending")
        .lt("due_date", today)
        .order("due_date", { ascending: true })
        .limit(50);
      return (data || []).map((m) => ({
        primary: `Maintenance due ${m.due_date ? format(new Date(m.due_date), "dd MMM yyyy") : "N/A"}`,
        secondary: m.notes || "No notes",
        badge: "overdue",
        badgeVariant: "destructive",
      }));
    }
    case "revenue_today": {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, grand_total, paid_date, payment_method")
        .eq("status", "paid")
        .gte("paid_date", today)
        .order("paid_date", { ascending: false })
        .limit(50);
      return (data || []).map((inv) => ({
        primary: inv.customer_name,
        secondary: `${inv.invoice_number} • ${inv.payment_method || "N/A"} • ${inv.paid_date ? format(new Date(inv.paid_date), "HH:mm") : ""}`,
        value: `R ${Number(inv.grand_total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        badge: "paid",
      }));
    }
    default:
      return [];
  }
}

export default KpiDetailDialog;

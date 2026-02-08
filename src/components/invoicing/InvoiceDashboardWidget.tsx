import { useState, useEffect } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

interface InvoiceDashboardWidgetProps {
  onViewAll?: () => void;
}

const InvoiceDashboardWidget = ({ onViewAll }: InvoiceDashboardWidgetProps) => {
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    paid: 0,
    overdue: 0,
    totalRevenue: 0,
    outstanding: 0,
  });

  useEffect(() => {
    fetchStats();

    // Realtime subscription
    const channel = supabase
      .channel("invoice-widget")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => {
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchStats = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("status, grand_total");

    if (data) {
      const invoices = data as unknown as { status: string; grand_total: number }[];
      setStats({
        total: invoices.length,
        draft: invoices.filter(i => i.status === "draft").length,
        sent: invoices.filter(i => i.status === "sent").length,
        paid: invoices.filter(i => i.status === "paid").length,
        overdue: invoices.filter(i => i.status === "overdue").length,
        totalRevenue: invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.grand_total, 0),
        outstanding: invoices.filter(i => ["sent", "overdue"].includes(i.status)).reduce((s, i) => s + i.grand_total, 0),
      });
    }
  };

  return (
    <div
      className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border cursor-pointer hover:shadow-md transition-shadow"
      onClick={onViewAll}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Invoicing</h3>
        </div>
        <Badge variant="secondary" className="text-[10px]">{stats.total} total</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Revenue</p>
          <p className="text-lg font-bold text-green-600">{formatCurrency(stats.totalRevenue)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Outstanding</p>
          <p className="text-lg font-bold text-orange-600">{formatCurrency(stats.outstanding)}</p>
        </div>
      </div>

      <div className="flex gap-3 mt-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
          {stats.draft} Draft
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          {stats.sent} Sent
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          {stats.paid} Paid
        </div>
        {stats.overdue > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            {stats.overdue} Overdue
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceDashboardWidget;

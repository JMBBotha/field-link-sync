import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Package } from "lucide-react";

const LowStockAlerts = () => {
  const { data: lowStockItems = [] } = useQuery({
    queryKey: ["low-stock-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, sku, quantity_in_stock, min_stock_level")
        .order("quantity_in_stock");
      if (error) throw error;
      return (data || []).filter(
        (item: any) => item.quantity_in_stock < item.min_stock_level
      );
    },
    refetchInterval: 60000,
  });

  if (lowStockItems.length === 0) return null;

  return (
    <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" />
          Low Stock Alerts ({lowStockItems.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {lowStockItems.slice(0, 5).map((item: any) => (
          <div
            key={item.id}
            className="flex items-center justify-between text-sm p-2 rounded bg-white dark:bg-background/50"
          >
            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-red-500" />
              <span className="font-medium">{item.name}</span>
              {item.sku && (
                <span className="text-xs text-muted-foreground">({item.sku})</span>
              )}
            </div>
            <span className="text-red-600 font-bold text-xs">
              {item.quantity_in_stock} / {item.min_stock_level}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default LowStockAlerts;

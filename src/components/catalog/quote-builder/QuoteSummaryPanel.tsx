import { useMemo, useState } from "react";
import { FileDown, Save, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Basket } from "../QuoteBuilderTab";
import { generateQuoteBuilderPDF } from "@/lib/quoteBuilderPDF";

interface QuoteSummaryPanelProps {
  baskets: Basket[];
}

const QuoteSummaryPanel = ({ baskets }: QuoteSummaryPanelProps) => {
  const [quoteName, setQuoteName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const summary = useMemo(() => {
    let totalItems = 0;
    let totalQty = 0;
    let grandTotal = 0;
    const zoneBreakdown: { name: string; items: number; qty: number; total: number }[] = [];

    baskets.forEach((b) => {
      let zoneTotal = 0;
      let zoneQty = 0;
      b.items.forEach((i) => {
        const price = i.product.selling_price || i.product.cost_incl_vat || 0;
        zoneTotal += price * i.quantity;
        zoneQty += i.quantity;
      });
      totalItems += b.items.length;
      totalQty += zoneQty;
      grandTotal += zoneTotal;
      if (b.items.length > 0) {
        zoneBreakdown.push({ name: b.name, items: b.items.length, qty: zoneQty, total: zoneTotal });
      }
    });

    return { totalItems, totalQty, grandTotal, zoneBreakdown };
  }, [baskets]);

  const handleExportPDF = () => {
    try {
      generateQuoteBuilderPDF(baskets, quoteName || "Quote");
      toast.success("PDF downloaded");
    } catch (err) {
      toast.error("Failed to generate PDF");
    }
  };

  const handleSave = async () => {
    if (!quoteName.trim()) {
      toast.error("Enter a quote name first");
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        toast.error("You must be logged in to save quotes");
        setSaving(false);
        return;
      }

      const zonesData = baskets.map((b) => ({
        id: b.id,
        name: b.name,
        items: b.items.map((i) => ({
          productId: i.product.id,
          productCode: i.product.product_code,
          productName: `${i.product.brand || ""} ${i.product.short_name || i.product.product_code}`.trim(),
          quantity: i.quantity,
          unitPrice: i.product.selling_price || i.product.cost_incl_vat || 0,
          category: i.product.product_category,
        })),
      }));

      // Use quotes table - store as a draft quote with visual_sections holding zone data
      const { data, error } = await (supabase.from("quotes") as any).insert({
        sales_engineer_id: userId,
        status: "draft",
        subtotal: summary.grandTotal / 1.15,
        vat_rate: 0.15,
        vat_amount: summary.grandTotal - summary.grandTotal / 1.15,
        total: summary.grandTotal,
        notes: quoteName,
        visual_sections: zonesData,
      }).select("id").single();

      if (error) throw error;
      setSavedId(data.id);
      toast.success("Quote saved successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to save quote");
    } finally {
      setSaving(false);
    }
  };

  if (summary.totalItems === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h4 className="text-sm font-semibold text-foreground">Quote Summary</h4>

      {/* Zone breakdown */}
      <div className="space-y-1.5">
        {summary.zoneBreakdown.map((z) => (
          <div key={z.name} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {z.name}
              <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">
                {z.items} items · {z.qty} qty
              </Badge>
            </span>
            <span className="font-medium">
              R{z.total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Total items</span>
          <span>{summary.totalItems} ({summary.totalQty} qty)</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Subtotal (excl. VAT)</span>
          <span>R{(summary.grandTotal / 1.15).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>VAT (15%)</span>
          <span>R{(summary.grandTotal - summary.grandTotal / 1.15).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-sm font-bold text-foreground border-t pt-1">
          <span>Grand Total</span>
          <span>R{summary.grandTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Input
          placeholder="Quote name..."
          value={quoteName}
          onChange={(e) => setQuoteName(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleExportPDF}>
          <FileDown className="h-3 w-3" /> PDF
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={handleSave}
          disabled={saving || !!savedId}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : savedId ? <CheckCircle className="h-3 w-3" /> : <Save className="h-3 w-3" />}
          {savedId ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );
};

export default QuoteSummaryPanel;

import { useMemo, useState, useRef } from "react";
import { FileDown, Save, Loader2, CheckCircle, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Basket } from "../QuoteBuilderTab";
import { getEffectiveUnitPrices } from "../QuoteBuilderTab";
import { generateQuoteBuilderPDF } from "@/lib/quoteBuilderPDF";
import { getProductDisplayName } from "./productDisplayUtils";
import { useUnifiedClients } from "@/hooks/useUnifiedClients";

interface QuoteSummaryPanelProps {
  baskets: Basket[];
}

const QuoteSummaryPanel = ({ baskets }: QuoteSummaryPanelProps) => {
  const [quoteName, setQuoteName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const { data: clients = [] } = useUnifiedClients();

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 8);
    const q = clientSearch.toLowerCase();
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [clients, clientSearch]);

  const selectedClient = useMemo(() =>
    selectedClientId ? clients.find(c => c.id === selectedClientId || c.customer_id === selectedClientId) : null
  , [clients, selectedClientId]);

  const summary = useMemo(() => {
    let totalItems = 0;
    let totalQty = 0;
    let grandTotal = 0;
    const zoneBreakdown: { name: string; items: number; qty: number; total: number }[] = [];

    baskets.forEach((b) => {
      let zoneTotal = 0;
      let zoneQty = 0;
      b.items.forEach((i) => {
        if (i.isBundle && i.bundleUnitPrice) {
          if (i.bundlePricingType === "p/meter") {
            zoneTotal += i.bundleUnitPrice * (i.length || 1);
          } else {
            zoneTotal += i.bundleUnitPrice * i.quantity;
          }
        } else if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
          zoneTotal += i.product.price_per_metre * i.length;
        } else {
          const { unitSell } = getEffectiveUnitPrices(i.product);
          zoneTotal += unitSell * i.quantity;
        }
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
          productName: getProductDisplayName(i.product),
          quantity: i.quantity,
          length: i.length || null,
          isLengthItem: i.product.sold_in_length && !!i.product.price_per_metre,
          pricePerMetre: i.product.price_per_metre || null,
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
        ...(selectedClientId ? { customer_id: selectedClientId.startsWith("lead-") ? null : selectedClientId } : {}),
        ...(selectedClient ? { customer_name: selectedClient.name } : {}),
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

      {/* Client selector */}
      <div className="relative">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Client</label>
        {selectedClient ? (
          <div className="flex items-center gap-1.5 rounded border bg-muted/50 px-2 py-1.5 text-xs">
            <Users className="h-3 w-3 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium truncate block">{selectedClient.name}</span>
              {selectedClient.phone && <span className="text-[10px] text-muted-foreground">{selectedClient.phone}</span>}
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => { setSelectedClientId(null); setClientSearch(""); }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Input
              ref={clientInputRef}
              placeholder="Search clients..."
              value={clientSearch}
              onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
              onFocus={() => setShowClientDropdown(true)}
              onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
              className="h-8 text-xs pr-7"
            />
            <Users className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            {showClientDropdown && filteredClients.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                {filteredClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedClientId(c.customer_id || c.id);
                      setQuoteName(c.name);
                      setClientSearch("");
                      setShowClientDropdown(false);
                    }}
                  >
                    <p className="text-xs font-medium truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
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

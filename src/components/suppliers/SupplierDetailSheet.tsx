import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Globe, MapPin, Pencil, Users, Package, FileText, Wallet, Tag, Settings2, Loader2, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";
import SupplierContactsTab from "./SupplierContactsTab";
import SupplierDocumentsTab from "./SupplierDocumentsTab";
import SupplierProductImporter from "@/components/catalog/SupplierProductImporter";

interface SupplierDetailSheetProps {
  supplierId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

const SupplierDetailSheet = ({ supplierId, open, onOpenChange, onEdit }: SupplierDetailSheetProps) => {
  const queryClient = useQueryClient();
  const [savingPricing, setSavingPricing] = useState(false);

  const { data: supplier } = useQuery({
    queryKey: ["supplier-detail", supplierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("id", supplierId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!supplierId && open,
  });

  const { data: productCount = 0 } = useQuery({
    queryKey: ["supplier-product-count", supplierId],
    queryFn: async () => {
      const { count, error } = await (supabase.from("supplier_products") as any)
        .select("*", { count: "exact", head: true })
        .eq("supplier_id", supplierId)
        .or("archived.is.null,archived.eq.false");
      if (error) throw error;
      return count || 0;
    },
    enabled: !!supplierId && open,
  });

  const [localPriceListType, setLocalPriceListType] = useState<string | null>(null);
  const [localTradeDiscount, setLocalTradeDiscount] = useState<number | null>(null);
  const [localMarkup, setLocalMarkup] = useState<number | null>(null);

  const priceListType = localPriceListType ?? supplier?.price_list_type ?? "cost_price";
  const tradeDiscount = localTradeDiscount ?? supplier?.default_trade_discount ?? 0;
  const markupPercent = localMarkup ?? supplier?.default_markup_percent ?? 20;

  const hasChanges =
    (localPriceListType !== null && localPriceListType !== (supplier?.price_list_type ?? "cost_price")) ||
    (localTradeDiscount !== null && localTradeDiscount !== (supplier?.default_trade_discount ?? 0)) ||
    (localMarkup !== null && localMarkup !== (supplier?.default_markup_percent ?? 20));

  const savePricingSettings = async () => {
    setSavingPricing(true);
    try {
      const { error } = await (supabase.from("suppliers") as any)
        .update({
          price_list_type: priceListType,
          default_trade_discount: priceListType === "list_price_with_discount" ? tradeDiscount : 0,
          default_markup_percent: markupPercent,
        })
        .eq("id", supplierId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["supplier-detail", supplierId] });
      setLocalPriceListType(null);
      setLocalTradeDiscount(null);
      setLocalMarkup(null);
      toast.success("Pricing settings saved");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingPricing(false);
    }
  };

  if (!supplier) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {supplier.company_name || supplier.name}
              </SheetTitle>
              {supplier.trading_name && (
                <p className="text-sm text-muted-foreground mt-1">t/a {supplier.trading_name}</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          </div>
        </SheetHeader>

        {/* Company info card */}
        <Card className="mb-4">
          <CardContent className="p-4 space-y-2 text-sm">
            {supplier.registration_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reg #</span>
                <span>{supplier.registration_number}</span>
              </div>
            )}
            {supplier.vat_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <span>{supplier.vat_number}</span>
              </div>
            )}
            {supplier.website && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" />Website</span>
                <a href={supplier.website.startsWith("http") ? supplier.website : `https://${supplier.website}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline truncate max-w-[200px]">
                  {supplier.website}
                </a>
              </div>
            )}
            {supplier.physical_address && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />Address</span>
                <span className="text-right max-w-[200px]">{supplier.physical_address}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="secondary" className="text-xs">
                {supplier.supplier_type === "consumables" ? "Consumables" : "AC Units"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" />Products</span>
              <span>{productCount}</span>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="contacts">
          <TabsList className="w-full">
            <TabsTrigger value="contacts" className="flex-1 gap-1">
              <Users className="h-3 w-3" /> Contacts
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1 gap-1">
              <Upload className="h-3 w-3" /> Import
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex-1 gap-1">
              <FileText className="h-3 w-3" /> Docs
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex-1 gap-1">
              <Settings2 className="h-3 w-3" /> Pricing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contacts">
            <SupplierContactsTab supplierId={supplierId} />
          </TabsContent>

          <TabsContent value="import">
            <div className="mt-2">
              {/* Uses the safe diff-based importer (archives missing products instead of
                  hard-deleting the whole catalog on every import) — see
                  docs/pricing-and-import-architecture-findings.md */}
              <SupplierProductImporter
                supplierId={supplierId}
                supplierName={supplier.company_name || supplier.name}
                isConsumablesSupplier={supplier.supplier_type === "consumables"}
                onComplete={() => {
                  queryClient.invalidateQueries({ queryKey: ["supplier-product-count", supplierId] });
                  queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
                  queryClient.invalidateQueries({ queryKey: ["admin-suppliers-list"] });
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="documents">
            <SupplierDocumentsTab supplierId={supplierId} supplierName={supplier.company_name || supplier.name} />
          </TabsContent>

          <TabsContent value="pricing">
            <div className="space-y-4 mt-2">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    💰 Pricing Configuration
                  </p>

                  <div className="space-y-2">
                    <Label className="text-xs">PDF Price List Type</Label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={priceListType === "cost_price" ? "default" : "outline"}
                        className="text-xs flex-1"
                        onClick={() => setLocalPriceListType("cost_price")}
                      >
                        <Wallet className="h-3 w-3 mr-1" /> Cost Price
                      </Button>
                      <Button
                        size="sm"
                        variant={priceListType === "list_price_with_discount" ? "default" : "outline"}
                        className="text-xs flex-1"
                        onClick={() => setLocalPriceListType("list_price_with_discount")}
                      >
                        <Tag className="h-3 w-3 mr-1" /> List + Discount
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {priceListType === "cost_price"
                        ? "This supplier's PDF shows our buy price directly — no discount needed."
                        : "PDF shows RRP/list price — trade discount applied to get cost price."}
                    </p>
                  </div>

                  {priceListType === "list_price_with_discount" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Default Trade Discount %</Label>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={tradeDiscount}
                        onChange={(e) => setLocalTradeDiscount(parseFloat(e.target.value) || 0)}
                        className="w-28 h-8 text-sm"
                      />
                    </div>
                  )}

                  {priceListType === "cost_price" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Trade Discount: N/A — cost price supplier.
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs">Default Markup %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      value={markupPercent}
                      onChange={(e) => setLocalMarkup(parseFloat(e.target.value) || 0)}
                      className="w-28 h-8 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">Applied to cost price for selling price calculation.</p>
                  </div>

                  {hasChanges && (
                    <Button size="sm" onClick={savePricingSettings} disabled={savingPricing} className="w-full">
                      {savingPricing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                      Save Pricing Settings
                    </Button>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    These are defaults. Each PDF import can override these settings individually.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default SupplierDetailSheet;

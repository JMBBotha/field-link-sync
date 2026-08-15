import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, CircleHelp, Columns, Download, Loader2, Search, Tag, Wallet } from "lucide-react";
import { formatRand } from "@/utils/formatRand";
import type { ImportPreview, ParsedProduct, PriceListType } from "@/services/productImportParser";
import { recalculateProducts } from "@/services/productImportParser";

interface ImportPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: ImportPreview;
  fileName: string;
  /** isFullCatalogue: true if this file represents the supplier's entire
   *  current catalogue (missing products get archived), false for a
   *  partial/delta file (nothing gets archived). */
  onConfirm: (products: ParsedProduct[], isFullCatalogue: boolean) => void;
  confirming?: boolean;
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  if (level === "high") return <Badge variant="default" className="bg-green-600 text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" />HIGH</Badge>;
  if (level === "medium") return <Badge variant="secondary" className="text-[10px] gap-1 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300"><CircleHelp className="h-3 w-3" />MEDIUM</Badge>;
  return <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" />LOW</Badge>;
}

const ImportPreviewModal = ({
  open,
  onOpenChange,
  preview,
  fileName,
  onConfirm,
  confirming = false,
}: ImportPreviewModalProps) => {
  const ss = preview.supplierSettings;
  const detectedCols = preview.detectedPriceColumns || [];
  const hasDiscount = preview.detectedDiscount > 0 || ss.tradeDiscount > 0;
  const defaultPriceListType: PriceListType = hasDiscount ? "list_price_with_discount" : "cost_price";

  const [priceListType, setPriceListType] = useState<PriceListType>(defaultPriceListType);
  const [isInclVat, setIsInclVat] = useState(preview.detectedPriceType === "incl_vat");
  const [discount, setDiscount] = useState(preview.detectedDiscount || ss.tradeDiscount);
  const [markup, setMarkup] = useState(ss.markupPercent);
  const [search, setSearch] = useState("");
  const [isFullCatalogue, setIsFullCatalogue] = useState(true);

  const effectiveDiscount = priceListType === "list_price_with_discount" ? discount : 0;

  const products = useMemo(
    () => recalculateProducts(preview.products, priceListType, isInclVat, effectiveDiscount, markup),
    [preview.products, priceListType, isInclVat, effectiveDiscount, markup]
  );

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) => p.model_number.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }, [products, search]);

  const sample = products[0];

  const handleDownloadCSV = () => {
    const header = "Model,Description,Category,List Price,Excl VAT,Cost Price,Our Price Excl,VAT,Sell Incl VAT\n";
    const rows = products
      .map((p) =>
        [p.model_number, `"${p.description}"`, p.category, p.raw_price, p.price_excl_vat, p.cost_price, p.calculated_price, p.vat_amount, p.sell_price_incl_vat].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-preview-${fileName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isCostPrice = priceListType === "cost_price";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            🤖 AI Import Analysis
          </DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
          {preview.parseMethod && (
            <div className={`flex items-center gap-2 text-xs rounded px-3 py-1.5 mt-1 ${
              preview.parseMethod === "grok_ai" || preview.parseMethod === "ai"
                ? "bg-green-500/10 text-green-700 dark:text-green-400"
                : preview.parseMethod === "lovable_ai"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : preview.parseMethod === "csv"
                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
            }`}>
              {preview.parseMethod === "grok_ai" && "🟢 HIGH — Enhanced with Deep-Image.ai + Parsed by Grok AI"}
              {preview.parseMethod === "ai" && "🟢 HIGH — Parsed using AI Vision"}
              {preview.parseMethod === "lovable_ai" && "🟢 GOOD — Parsed using Lovable AI"}
              {preview.parseMethod === "csv" && "🔵 CSV — Structured data import"}
              {preview.parseMethod === "regex" && "🟡 STANDARD — Parsed using text extraction. AI APIs may be unavailable."}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-4 pr-1">
            {/* Detected Price Columns */}
            {detectedCols.length > 1 && (
              <Card className="border-blue-200 dark:border-blue-800">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Columns className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <div>
                        <p className="text-sm font-semibold">Detected Price Columns</p>
                        <p className="text-[11px] text-muted-foreground">
                          AI found multiple price columns. Using <span className="font-bold">"{preview.selectedPriceColumn || detectedCols[0]}"</span> (the excl VAT / lowest column).
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {detectedCols.map((col) => (
                          <Badge
                            key={col}
                            variant={col === (preview.selectedPriceColumn || detectedCols[0]) ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {col}
                            {col === (preview.selectedPriceColumn || detectedCols[0]) && " ✓"}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Price List Type Toggle */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-3">
                  {isCostPrice ? (
                    <Wallet className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  ) : (
                    <Tag className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {isCostPrice ? "Cost Price" : "List Price with Trade Discount"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {isCostPrice
                          ? "This supplier's PDF shows our buy price directly — no discount needed."
                          : "PDF shows RRP/list price — trade discount applied to get cost price."}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={isCostPrice ? "default" : "outline"}
                        className="text-xs"
                        onClick={() => setPriceListType("cost_price")}
                      >
                        <Wallet className="h-3 w-3 mr-1" /> Cost Price
                      </Button>
                      <Button
                        size="sm"
                        variant={!isCostPrice ? "default" : "outline"}
                        className="text-xs"
                        onClick={() => setPriceListType("list_price_with_discount")}
                      >
                        <Tag className="h-3 w-3 mr-1" /> List Price + Discount
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Settings */}
            <Card>
              <CardContent className="p-4 space-y-4">
                {/* VAT Toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-xs">Prices in document</Label>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${!isInclVat ? "font-bold" : "text-muted-foreground"}`}>Excl VAT</span>
                      <Switch checked={isInclVat} onCheckedChange={setIsInclVat} />
                      <span className={`text-xs ${isInclVat ? "font-bold" : "text-muted-foreground"}`}>Incl VAT</span>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <ConfidenceBadge level={preview.vatConfidence} />
                    <p className="text-[10px] text-muted-foreground max-w-[200px]">{preview.vatEvidence}</p>
                  </div>
                </div>

                {/* Trade Discount — only for list_price_with_discount */}
                {!isCostPrice ? (
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label className="text-xs">Trade Discount %</Label>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={discount}
                        onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                        className="w-24 h-8 text-sm"
                      />
                    </div>
                    <div className="text-right space-y-0.5">
                      <ConfidenceBadge level={preview.discountConfidence} />
                      <p className="text-[10px] text-muted-foreground max-w-[200px]">{preview.discountEvidence}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Trade Discount: N/A — this supplier lists cost prices directly.
                  </div>
                )}

                {/* Markup */}
                <div className="space-y-0.5">
                  <Label className="text-xs">Our Markup % (on cost price)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    value={markup}
                    onChange={(e) => setMarkup(parseFloat(e.target.value) || 0)}
                    className="w-24 h-8 text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Price Calculation Preview */}
            {sample && (
              <Card className="bg-muted/30">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold mb-2">
                    Calculation Example — {sample.model_number}
                  </p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs font-mono">
                    <span className="text-muted-foreground">
                      {isCostPrice ? "Cost" : "List"} Price ({isInclVat ? "Incl" : "Excl"} VAT):
                    </span>
                    <span className="text-right">{formatRand(sample.raw_price)}</span>

                    {isInclVat && (
                      <>
                        <span className="text-muted-foreground">Strip 15% VAT:</span>
                        <span className="text-right text-destructive">− {formatRand(sample.raw_price - (sample.price_excl_vat ?? sample.raw_price))}</span>
                      </>
                    )}

                    {!isCostPrice && (
                      <>
                        <span className="text-muted-foreground">= Price Excl VAT:</span>
                        <span className="text-right">{formatRand(sample.price_excl_vat ?? sample.raw_price)}</span>

                        {effectiveDiscount > 0 && (
                          <>
                            <span className="text-muted-foreground">Less {effectiveDiscount}% Trade Discount:</span>
                            <span className="text-right text-destructive">− {formatRand((sample.price_excl_vat ?? sample.raw_price) - sample.cost_price)}</span>
                          </>
                        )}
                      </>
                    )}

                    <span className="text-muted-foreground font-semibold">= Cost Price (Excl VAT):</span>
                    <span className="text-right font-semibold">{formatRand(sample.cost_price)}</span>

                    <span className="text-muted-foreground">Plus {markup}% Markup:</span>
                    <span className="text-right text-green-600 dark:text-green-400">+ {formatRand((sample.calculated_price ?? sample.selling_price) - sample.cost_price)}</span>

                    <span className="text-muted-foreground">= Sell Price (Excl VAT):</span>
                    <span className="text-right">{formatRand(sample.calculated_price ?? sample.selling_price)}</span>

                    <span className="text-muted-foreground">Plus 15% VAT:</span>
                    <span className="text-right">+ {formatRand(sample.vat_amount ?? 0)}</span>

                    <span className="text-muted-foreground font-bold">= Sell Price (Incl VAT):</span>
                    <span className="text-right font-bold text-primary">{formatRand(sample.sell_price_incl_vat ?? sample.selling_price_incl_vat)}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div className="space-y-1">
                {preview.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400 rounded px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Product Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">
                  Product Preview ({products.length} products)
                </p>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 text-xs pl-8 w-48"
                    />
                  </div>
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={handleDownloadCSV}>
                    <Download className="h-3 w-3" /> CSV
                  </Button>
                </div>
              </div>

              <div className="border rounded-md max-h-[300px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Model</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs text-right">{isCostPrice ? "Cost" : "List"} Price</TableHead>
                      <TableHead className="text-xs text-right">Cost</TableHead>
                      <TableHead className="text-xs text-right">Our Price</TableHead>
                      <TableHead className="text-xs text-right">Sell Incl</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 100).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono font-semibold py-1.5">{p.model_number}</TableCell>
                        <TableCell className="text-xs py-1.5 max-w-[200px] truncate">{p.description}</TableCell>
                        <TableCell className="text-xs text-right py-1.5 text-muted-foreground">{formatRand(p.raw_price)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5">{formatRand(p.cost_price)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5">{formatRand(p.calculated_price ?? p.selling_price)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5 font-semibold">{formatRand(p.sell_price_incl_vat ?? p.selling_price_incl_vat)}</TableCell>
                      </TableRow>
                    ))}
                    {filtered.length > 100 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-2">
                          Showing 100 of {filtered.length} — download CSV for full list
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                          {search ? "No products match search" : "No products found in file"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2 pt-4 border-t mt-4">
          <div className="flex items-center gap-2">
            <Switch id="import-is-full-catalogue" checked={isFullCatalogue} onCheckedChange={setIsFullCatalogue} disabled={confirming} />
            <Label htmlFor="import-is-full-catalogue" className="text-xs whitespace-nowrap cursor-pointer">
              Full price list
              <span className="text-muted-foreground ml-1">
                {isFullCatalogue ? "(missing items archived)" : "(partial file, nothing archived)"}
              </span>
            </Label>
          </div>
          <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(products, isFullCatalogue)} disabled={confirming || products.length === 0}>
            {confirming ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Uploading...</>
            ) : (
              <>✅ Confirm & Upload {products.length} Products</>
            )}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportPreviewModal;
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
import { AlertTriangle, CheckCircle2, CircleHelp, Download, Loader2, Search } from "lucide-react";
import { formatRand } from "@/utils/formatRand";
import type { ImportPreview, ParsedProduct } from "@/services/productImportParser";
import { recalculateProducts } from "@/services/productImportParser";

interface ImportPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: ImportPreview;
  fileName: string;
  onConfirm: (products: ParsedProduct[]) => void;
  confirming?: boolean;
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  if (level === "high") return <Badge variant="default" className="bg-green-600 text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" />HIGH</Badge>;
  if (level === "medium") return <Badge variant="secondary" className="text-[10px] gap-1 bg-yellow-500/20 text-yellow-700"><CircleHelp className="h-3 w-3" />MEDIUM</Badge>;
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
  const [isInclVat, setIsInclVat] = useState(preview.detectedPriceType === "incl_vat");
  const [discount, setDiscount] = useState(preview.detectedDiscount);
  const [markup, setMarkup] = useState(preview.suggestedMarkup);
  const [search, setSearch] = useState("");

  const products = useMemo(
    () => recalculateProducts(preview.products, isInclVat, discount, markup),
    [preview.products, isInclVat, discount, markup]
  );

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.model_number.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [products, search]);

  // Sample product for preview calculation box
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            🤖 AI Import Analysis
          </DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2 -mr-2">
          <div className="space-y-4">
            {/* Detected Settings */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <p className="text-sm font-semibold">Detected Settings</p>

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

                {/* Discount */}
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-xs">Supplier Trade Discount %</Label>
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
                  <p className="text-xs font-semibold mb-2">Price Calculation Preview — {sample.model_number}</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs font-mono">
                    <span className="text-muted-foreground">List Price ({isInclVat ? "Incl" : "Excl"} VAT):</span>
                    <span className="text-right">{formatRand(sample.raw_price)}</span>

                    {isInclVat && (
                      <>
                        <span className="text-muted-foreground">Strip 15% VAT:</span>
                        <span className="text-right text-destructive">− {formatRand(sample.raw_price - sample.price_excl_vat)}</span>
                      </>
                    )}

                    <span className="text-muted-foreground">= Price Excl VAT:</span>
                    <span className="text-right">{formatRand(sample.price_excl_vat)}</span>

                    {discount > 0 && (
                      <>
                        <span className="text-muted-foreground">Less {discount}% Trade Discount:</span>
                        <span className="text-right text-destructive">− {formatRand(sample.price_excl_vat - sample.cost_price)}</span>
                      </>
                    )}

                    <span className="text-muted-foreground font-semibold">= Cost Price (Excl VAT):</span>
                    <span className="text-right font-semibold">{formatRand(sample.cost_price)}</span>

                    <span className="text-muted-foreground">Plus {markup}% Markup:</span>
                    <span className="text-right text-green-600">+ {formatRand(sample.calculated_price - sample.cost_price)}</span>

                    <span className="text-muted-foreground">= Our Sell Price (Excl VAT):</span>
                    <span className="text-right">{formatRand(sample.calculated_price)}</span>

                    <span className="text-muted-foreground">Plus 15% VAT:</span>
                    <span className="text-right">+ {formatRand(sample.vat_amount)}</span>

                    <span className="text-muted-foreground font-bold">= Sell Price (Incl VAT):</span>
                    <span className="text-right font-bold text-primary">{formatRand(sample.sell_price_incl_vat)}</span>
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
                      <TableHead className="text-xs text-right">List Price</TableHead>
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
                        <TableCell className="text-xs text-right py-1.5">{formatRand(p.calculated_price)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5 font-semibold">{formatRand(p.sell_price_incl_vat)}</TableCell>
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
        </ScrollArea>

        <DialogFooter className="flex-row justify-between sm:justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(products)} disabled={confirming || products.length === 0}>
            {confirming ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Uploading...</>
            ) : (
              <>✅ Confirm & Upload {products.length} Products</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportPreviewModal;

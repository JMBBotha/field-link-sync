import { useState, useMemo, useCallback, lazy, Suspense } from "react";
import { RotateCcw, FileDown, Loader2, Mail, Check, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import QuantityControl from "../QuantityControl";
import { supabase } from "@/integrations/supabase/client";
import { pdf } from "@react-pdf/renderer";
import QuotePDFDocument from "@/components/QuotePDFDocument";
import type { QuoteArea } from "../quoteWizardTypes";
import type { QuotePDFData, QuotePDFSubItem } from "@/components/QuotePDFDocument";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
}

const VAT_RATE = 0.15;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

interface AreaPricing {
  areaId: string;
  quantity: number;
  markupPercent: number;
}

/** Returns a color class based on markup percentage */
function getMarkupColor(markup: number): string {
  if (markup <= 20) return "bg-green-500";
  if (markup <= 35) return "bg-amber-400";
  return "bg-red-500";
}

/* Lazy-load heavy PDF components */
const PDFDownloadButton = lazy(() => import("./PDFDownloadButton"));

export default function PricingStep({ areas, onAreasChange }: Props) {
  const [globalMarkup, setGlobalMarkup] = useState(30);
  const [pdfReady, setPdfReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [areaPricing, setAreaPricing] = useState<Record<string, AreaPricing>>(() => {
    const init: Record<string, AreaPricing> = {};
    for (const a of areas) {
      init[a.id] = { areaId: a.id, quantity: a.acUnits[0]?.quantity || 1, markupPercent: 30 };
    }
    return init;
  });

  const getPricing = (areaId: string) =>
    areaPricing[areaId] || { areaId, quantity: 1, markupPercent: globalMarkup };

  const updateAreaPricing = useCallback((areaId: string, patch: Partial<AreaPricing>) => {
    setAreaPricing((prev) => ({
      ...prev,
      [areaId]: { ...prev[areaId], areaId, quantity: prev[areaId]?.quantity || 1, markupPercent: prev[areaId]?.markupPercent ?? globalMarkup, ...patch },
    }));
  }, [globalMarkup]);

  const resetAllToGlobal = useCallback(() => {
    setAreaPricing((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = { ...next[key], markupPercent: globalMarkup };
      }
      return next;
    });
  }, [globalMarkup]);

  const allHaveUnits = areas.every((a) => a.acUnits.length > 0);

  // Compute totals
  const lineItems = useMemo(() => {
    return areas.map((area) => {
      const unit = area.acUnits[0];
      if (!unit) return { area, costPrice: 0, quantity: 1, markup: 0, sellingPrice: 0, lineTotal: 0 };
      const pricing = getPricing(area.id);
      const costPrice = unit.product.cost_excl_vat || unit.product.cost_incl_vat || 0;
      const sellingPrice = costPrice * (1 + pricing.markupPercent / 100);
      const lineTotal = sellingPrice * pricing.quantity;
      return { area, costPrice, quantity: pricing.quantity, markup: pricing.markupPercent, sellingPrice, lineTotal };
    });
  }, [areas, areaPricing, globalMarkup]);

  const subtotal = useMemo(() => lineItems.reduce((s, l) => s + l.lineTotal, 0), [lineItems]);
  const vatAmount = useMemo(() => subtotal * VAT_RATE, [subtotal]);
  const total = useMemo(() => subtotal + vatAmount, [subtotal, vatAmount]);
  const avgMarkup = useMemo(() => {
    const withUnits = lineItems.filter((l) => l.markup > 0);
    return withUnits.length > 0 ? withUnits.reduce((s, l) => s + l.markup, 0) / withUnits.length : 0;
  }, [lineItems]);

  // Build PDF data
  const quoteData: QuotePDFData | null = useMemo(() => {
    if (!pdfReady || !allHaveUnits) return null;
    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setDate(validUntil.getDate() + 30);

    return {
      quoteNumber: `AQ-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      date: now.toLocaleDateString("en-ZA"),
      validUntil: validUntil.toLocaleDateString("en-ZA"),
      clientName: "",
      clientEmail: "",
      items: lineItems.map((li) => {
        const subItems: QuotePDFSubItem[] = [];
        for (const mat of li.area.materials) {
          const isLen = mat.pricingMode === "length";
          const unitPrice = isLen ? mat.costPerMeter : (mat.product.selling_price || mat.product.cost_incl_vat || 0);
          const qty = isLen ? mat.adjustedLength : mat.unitQuantity;
          const lineTotal = isLen ? mat.totalCost : unitPrice * mat.unitQuantity;
          subItems.push({ name: mat.product.short_name || mat.product.product_code, quantity: qty, unitPrice, lineTotal, pricingMode: isLen ? "per-meter" : "per-unit" });
        }
        for (const cons of (li.area.consumables ?? [])) {
          const price = cons.product.selling_price || cons.product.cost_incl_vat || 0;
          subItems.push({ name: cons.product.short_name || cons.product.product_code, quantity: cons.quantity, unitPrice: price, lineTotal: price * cons.quantity, pricingMode: "per-unit" });
        }
        for (const br of li.area.brackets) {
          subItems.push({ name: `Bracket ${br.size}`, quantity: br.quantity, unitPrice: br.price, lineTotal: br.price * br.quantity, pricingMode: "per-unit" });
        }
        return {
          areaName: li.area.name,
          unitName: li.area.acUnits[0]?.product.name || li.area.acUnits[0]?.product.short_name || li.area.acUnits[0]?.product.product_code || "—",
          btu: li.area.acUnits[0]?.btu || 0,
          quantity: li.quantity,
          unitPrice: li.sellingPrice,
          markupPercent: li.markup,
          lineTotal: li.lineTotal,
          subItems: subItems.length > 0 ? subItems : undefined,
        };
      }),
      subtotal,
      vatRate: VAT_RATE,
      vatAmount,
      total,
    };
  }, [pdfReady, allHaveUnits, lineItems, subtotal, vatAmount, total]);

  return (
    <div className="space-y-4 overflow-x-auto">
      {/* Global markup */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Global Markup
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={resetAllToGlobal}>
              <RotateCcw className="h-3 w-3" /> Reset All
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Label className="text-xs text-muted-foreground whitespace-nowrap cursor-help">Default Markup %</Label>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                Set the default profit margin applied to all areas. Higher markup increases profit but may reduce client acceptance.
              </TooltipContent>
            </Tooltip>
            <Input
              type="number"
              value={globalMarkup}
              onChange={(e) => { setGlobalMarkup(parseFloat(e.target.value) || 0); setPdfReady(false); }}
              className="h-8 w-24 text-sm"
              min={0}
              step={5}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sticky pricing table header */}
      <div className="rounded-lg border shadow-sm overflow-hidden">
        <div className="sticky top-0 z-10 bg-background shadow-sm border-b">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[500px]">
            <span>Area</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Cost</span>
            <span className="text-center">Markup</span>
            <span className="text-right">Line Total</span>
          </div>
        </div>

        {/* Per-area pricing rows with zebra striping */}
        <div className="min-w-[500px]">
          {lineItems.map(({ area, costPrice, quantity, markup, sellingPrice, lineTotal }, idx) => {
            const unit = area.acUnits[0];
            const pricing = getPricing(area.id);
            const isOdd = idx % 2 === 1;

            return (
              <div
                key={area.id}
                className={`grid grid-cols-[1fr_auto_auto_auto_auto] sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-3 items-center border-b last:border-0 transition-colors ${isOdd ? "bg-muted/30" : "bg-background"}`}
              >
                {/* Area name + badge */}
                <div className="min-w-0">
                  <span className="text-sm font-medium truncate block">{area.name}</span>
                  {unit ? (
                    <Badge variant="outline" className="text-[9px] mt-0.5">
                      {unit.product.product_code} · {unit.btu.toLocaleString()} BTU
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[9px] mt-0.5">No unit</Badge>
                  )}
                </div>

                {/* Qty */}
                <div className="flex justify-center">
                  {unit ? (
                    <QuantityControl
                      value={pricing.quantity}
                      onChange={(v) => { updateAreaPricing(area.id, { quantity: v }); setPdfReady(false); }}
                      min={1}
                      max={20}
                      showSlider={false}
                      sliderTooltip="Adjust unit quantity"
                    />
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </div>

                {/* Cost */}
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">{unit ? formatCurrency(costPrice) : "—"}</span>
                </div>

                {/* Markup */}
                <div className="flex justify-center">
                  {unit ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          type="number"
                          value={pricing.markupPercent}
                          onChange={(e) => { updateAreaPricing(area.id, { markupPercent: parseFloat(e.target.value) || 0 }); setPdfReady(false); }}
                          className="h-7 text-xs w-16 text-center"
                          min={0}
                          step={5}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs max-w-[200px]">
                        Higher markup = higher profit but may reduce acceptance rate
                      </TooltipContent>
                    </Tooltip>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </div>

                {/* Line total */}
                <div className="text-right">
                  <span className="text-xs font-semibold">{unit ? formatCurrency(lineTotal) : "—"}</span>
                  {unit && (
                    <span className="block text-[9px] text-muted-foreground">
                      {formatCurrency(sellingPrice)} × {quantity}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Card */}
      <Card className="shadow-md border-primary/10">
        <CardContent className="py-4 px-4 space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
            <span className="font-medium">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(vatAmount)}</span>
          </div>
          <Separator />

          {/* Grand total - highlighted */}
          <div className="flex justify-between items-center text-lg font-bold rounded-lg bg-primary/5 px-3 py-2 -mx-1 text-primary">
            <span>Total Incl. VAT</span>
            <span>{formatCurrency(total)}</span>
          </div>

          {/* Markup impact bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Avg. Markup: {avgMarkup.toFixed(0)}%
              </span>
              <span>
                {avgMarkup <= 20 ? "Conservative" : avgMarkup <= 35 ? "Standard" : "Aggressive"}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getMarkupColor(avgMarkup)}`}
                style={{ width: `${Math.min(100, (avgMarkup / 50) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>0%</span>
              <span>25%</span>
              <span>50%+</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate Quote / Download PDF / Send Email */}
      <div className="space-y-2">
        {!pdfReady ? (
          <Button
            className="w-full"
            onClick={() => setPdfReady(true)}
            disabled={!allHaveUnits}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Generate Quote
          </Button>
        ) : quoteData ? (
          <div className="flex flex-col sm:flex-row gap-3">
            <Suspense fallback={
              <Button className="flex-1" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing PDF…
              </Button>
            }>
              <PDFDownloadButton data={quoteData} />
            </Suspense>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={sending || emailSent || !allHaveUnits || !quoteData.clientEmail}
              onClick={async () => {
                if (!quoteData) return;
                setSending(true);
                try {
                  const blob = await pdf(<QuotePDFDocument data={quoteData} />).toBlob();
                  const arrayBuffer = await blob.arrayBuffer();
                  const bytes = new Uint8Array(arrayBuffer);
                  let binary = "";
                  for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                  }
                  const pdfBase64 = btoa(binary);

                  const unsubscribeToken = crypto.randomUUID();
                  const { error } = await supabase.functions.invoke("send-quote-email", {
                    body: {
                      to: quoteData.clientEmail,
                      subject: `Your 0800BeCool Quote ${quoteData.quoteNumber}`,
                      quoteNumber: quoteData.quoteNumber,
                      clientName: quoteData.clientName,
                      totalAmount: quoteData.total,
                      unsubscribeToken,
                      pdfBase64,
                    },
                  });

                  if (error) throw error;
                  setEmailSent(true);
                  toast.success(`Quote sent to ${quoteData.clientEmail}!`);
                } catch (err: any) {
                  toast.error(err?.message || "Failed to send quote email");
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
              ) : emailSent ? (
                <><Check className="h-4 w-4 mr-2" /> Sent ✓</>
              ) : (
                <><Mail className="h-4 w-4 mr-2" /> Send Quote Email</>
              )}
            </Button>
          </div>
        ) : null}
        {pdfReady && quoteData && !quoteData.clientEmail && (
          <p className="text-xs text-muted-foreground text-center">
            Add a client email to enable email sending.
          </p>
        )}
      </div>

      {!allHaveUnits && (
        <p className="text-xs text-destructive text-center">
          Some areas have no AC unit selected. Go back to Step 2 to assign units.
        </p>
      )}
    </div>
  );
}

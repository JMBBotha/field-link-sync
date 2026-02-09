import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface SupplierProductImporterProps {
  supplierId: string;
  supplierName: string;
  onComplete: () => void;
}

/** Parse specs from description text */
function parseSpecs(text: string) {
  const refrigerantMatch = text.match(/R(32|410A|22|290)/i);
  const refrigerant = refrigerantMatch ? `R${refrigerantMatch[1].toUpperCase()}` : null;

  // BTU: look for 4-5 digit number near "BTU" or standalone patterns like 9000, 12000, 18000
  let btu: number | null = null;
  const btuExplicit = text.match(/(\d{4,6})\s*BTU/i);
  if (btuExplicit) {
    btu = parseInt(btuExplicit[1]);
  } else {
    const btuImplied = text.match(/\b(9|12|18|24|36|48|60)\s*(?:000|k)\b/i);
    if (btuImplied) {
      const n = parseInt(btuImplied[1]);
      btu = n < 100 ? n * 1000 : n;
    }
  }

  // Mounting type
  let mounting: string | null = null;
  const mountMatch = text.match(/\b(midwall|wall|cassette|floor|ceiling|duct|ducted|portable|concealed)\b/i);
  if (mountMatch) mounting = mountMatch[1].charAt(0).toUpperCase() + mountMatch[1].slice(1).toLowerCase();
  if (mounting === "Midwall") mounting = "Wall";
  if (mounting === "Ducted") mounting = "Duct";

  // Pipe sizes - look for fraction patterns like 1/4 3/8 or 3/8 5/8
  let pipeLiquid: string | null = null;
  let pipeGas: string | null = null;
  const pipeMatch = text.match(/(\d+\/\d+)\s*[\s&,-]+\s*(\d+\/\d+)/);
  if (pipeMatch) {
    pipeLiquid = pipeMatch[1];
    pipeGas = pipeMatch[2];
  }

  return { refrigerant, btu, mounting, pipeLiquid, pipeGas };
}

const SupplierProductImporter = ({ supplierId, supplierName, onComplete }: SupplierProductImporterProps) => {
  const [tab, setTab] = useState<"paste" | "csv" | "ai">("paste");
  const [pasteText, setPasteText] = useState("");
  const [markupPercent, setMarkupPercent] = useState(30);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{ imported: number; updated: number; skipped: number } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    queryClient.invalidateQueries({ queryKey: ["comparison-products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-from-catalog"] });
  };

  /** Parse pasted CSV text with category-header detection */
  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;
    setImporting(true);
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      const lines = pasteText.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setError("Need at least a header row and one data row");
        setImporting(false);
        return;
      }

      // Parse header - support tab or comma
      const delimiter = lines[0].includes("\t") ? "\t" : ",";
      const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));

      // Find column indices (flexible matching)
      const findCol = (keywords: string[]) =>
        headers.findIndex(h => keywords.some(k => h.toLowerCase().replace(/[^a-z]/g, "").includes(k)));

      const skuIdx = findCol(["sku", "productcode", "code", "itemcode"]);
      const nameIdx = findCol(["name", "description", "desc", "product"]);
      const descIdx = findCol(["description", "desc"]);
      const costIdx = findCol(["unitcost", "cost", "nett", "price", "nettprice"]);

      // Use name col, fallback to first col
      const primaryNameIdx = nameIdx >= 0 ? nameIdx : (skuIdx >= 0 ? (skuIdx === 0 ? 1 : 0) : 0);
      const descriptionIdx = descIdx >= 0 && descIdx !== primaryNameIdx ? descIdx : -1;

      let currentCategory = "";
      const rows: any[] = [];
      const seenSkus = new Set<string>();
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(delimiter).map(c => c.trim().replace(/^"|"$/g, ""));
        const sku = skuIdx >= 0 ? cells[skuIdx]?.trim() : "";
        const name = cells[primaryNameIdx]?.trim() || "";

        // Blank SKU = category header
        if (!sku && name) {
          currentCategory = name;
          continue;
        }
        if (!sku || !name) {
          skippedCount++;
          continue;
        }

        // Duplicate SKU check
        if (seenSkus.has(sku.toUpperCase())) {
          skippedCount++;
          continue;
        }
        seenSkus.add(sku.toUpperCase());

        // Parse cost
        let costRaw = costIdx >= 0 ? cells[costIdx] || "" : "";
        costRaw = costRaw.replace(/[Rr\s]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
        const unitCost = parseFloat(costRaw) || 0;

        const description = descriptionIdx >= 0 ? cells[descriptionIdx]?.trim() || "" : "";
        const fullText = `${name} ${description}`;
        const specs = parseSpecs(fullText);

        rows.push({
          supplier_id: supplierId,
          product_code: sku,
          description: name,
          category: currentCategory || "Uncategorized",
          cost_price: unitCost,
          selling_price: unitCost > 0 ? Math.round(unitCost * (1 + markupPercent / 100) * 100) / 100 : 0,
          default_markup_percent: markupPercent,
          btu_rating: specs.btu,
          refrigerant_type: specs.refrigerant,
          pipe_size: specs.pipeLiquid && specs.pipeGas ? `${specs.pipeLiquid} ${specs.pipeGas}` : specs.pipeLiquid || null,
          is_active: true,
          is_price_on_request: unitCost === 0,
        });
      }

      if (rows.length === 0) {
        setError("No valid product rows found. Ensure SKU column is present and rows have data.");
        setImporting(false);
        return;
      }

      // Batch upsert
      const batchSize = 50;
      let imported = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from("supplier_products" as any)
          .upsert(batch as any, { onConflict: "supplier_id,product_code" });
        if (insertError) {
          // Try individual inserts for better error handling
          for (const row of batch) {
            const { error: singleErr } = await supabase
              .from("supplier_products" as any)
              .upsert(row as any, { onConflict: "supplier_id,product_code" });
            if (singleErr) errorCount++;
            else imported++;
          }
        } else {
          imported += batch.length;
        }
        setProgress(Math.round(((i + batch.length) / rows.length) * 100));
      }

      setResult({ imported, skipped: skippedCount, errors: errorCount });
      toast({ title: `${imported} products imported successfully` });
      invalidateAll();
      onComplete();
    } catch (err: any) {
      setError(err.message || "Import failed");
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleAIParse = async () => {
    if (!aiText.trim()) return;
    setAiParsing(true);
    setError(null);
    setAiResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("parse-price-list", {
        body: { csv_text: aiText, supplier_id: supplierId, supplier_name: supplierName },
      });
      if (fnError) throw fnError;
      if (data?.error && !data?.success) throw new Error(data.error);
      setAiResult({ imported: data.imported, updated: data.updated, skipped: data.skipped });
      toast({ title: "AI Parse Complete", description: `${data.imported} new, ${data.updated} updated` });
      if (data.imported > 0 || data.updated > 0) { invalidateAll(); onComplete(); }
    } catch (err: any) {
      setError(err.message || "AI parsing failed");
      toast({ title: "AI Parse Failed", description: err.message, variant: "destructive" });
    } finally {
      setAiParsing(false);
    }
  };

  const lineCount = pasteText.split("\n").filter(l => l.trim()).length;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Import Products for {supplierName}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="paste" className="text-xs">
              <Upload className="h-3 w-3 mr-1" /> Paste CSV
            </TabsTrigger>
            <TabsTrigger value="ai" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" /> AI PDF Parse
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-3 mt-3">
            <div>
              <Label className="text-xs font-medium">Paste CSV here</Label>
              <p className="text-[10px] text-muted-foreground mb-1">
                Columns: SKU, Name, Description, Unit Cost — blank SKU rows become category headers
              </p>
              <Textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setResult(null); setError(null); }}
                placeholder={`SKU,Name,Description,Unit Cost\n,,BREEZELESS E R32 INVERTER,\nBZE-INV-09,INVERTER 9000 BTU HEATPUMP MIDWALL - R32,,R 7700.00\nBZE-INV-12,INVERTER 12000 BTU HEATPUMP MIDWALL - R32,,R 9100.00`}
                rows={10}
                className="text-xs font-mono"
              />
              {lineCount > 1 && (
                <p className="text-[10px] text-muted-foreground mt-1">{lineCount} lines detected</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Markup %</Label>
                <Input
                  type="number"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(Number(e.target.value) || 0)}
                  className="w-20 h-8 text-sm"
                  min={0}
                  max={200}
                />
              </div>
              <Button
                size="sm"
                onClick={handlePasteImport}
                disabled={importing || lineCount < 2}
                className="ml-auto"
              >
                {importing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3 w-3 mr-1" />
                )}
                Import Products
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="space-y-3 mt-3">
            <div>
              <Label className="text-xs">Paste price list text (from PDF copy-paste)</Label>
              <Textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="Paste the raw text from your supplier PDF here..."
                rows={8}
                className="text-xs font-mono"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" onClick={handleAIParse} disabled={aiParsing || !aiText.trim()}>
                {aiParsing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                {aiParsing ? "Parsing..." : "Parse with AI"}
              </Button>
            </div>
            {aiResult && (
              <div className="bg-primary/10 text-primary p-3 rounded-lg text-sm">
                ✅ {aiResult.imported} imported, {aiResult.updated} updated, {aiResult.skipped} skipped
              </div>
            )}
          </TabsContent>
        </Tabs>

        {importing && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Importing...</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {result && (
          <div className="bg-primary/10 text-primary p-3 rounded-lg text-sm">
            ✅ {result.imported} imported, {result.skipped} skipped{result.errors > 0 ? `, ${result.errors} errors` : ""}
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplierProductImporter;

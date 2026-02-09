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

/** Auto-repair CSV that was pasted as a single line (no newlines) */
function autoRepairCsv(text: string): string {
  // If it already has real newlines with multiple rows, leave it alone
  const existingLines = text.split("\n").filter(l => l.trim());
  if (existingLines.length > 1) {
    console.log("[Importer][Grok] CSV already has", existingLines.length, "lines, skipping repair");
    return text;
  }

  console.log("[Importer][Grok] Single-line CSV detected, auto-repairing...");

  // Step 0: Insert missing commas where a cost value is glued to the next SKU
  // e.g. "R 7700.00BZE-INV-12" → "R 7700.00,BZE-INV-12"
  let t = text.replace(/(\d{2,}\.\d{2})([A-Z])/g, "$1,$2");
  console.log("[Importer][Grok] After comma insertion:", t);

  // Split all values respecting quoted fields
  const allValues: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of t) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { allValues.push(current); current = ""; continue; }
    current += ch;
  }
  allValues.push(current);

  console.log("[Importer][Grok] Total comma-separated values:", allValues.length);

  // Detect column count from header
  let numCols = 4;
  const headerEndIdx = allValues.findIndex((v, i) => 
    i > 0 && /unit\s*cost|nett.*price|cost.*price/i.test(v.trim())
  );
  if (headerEndIdx > 0) {
    numCols = headerEndIdx + 1;
  }
  console.log("[Importer][Grok] Detected", numCols, "columns");

  // Rebuild rows by grouping values into chunks of numCols
  const rows: string[] = [];
  for (let i = 0; i < allValues.length; i += numCols) {
    const chunk = allValues.slice(i, i + numCols);
    while (chunk.length < numCols) chunk.push("");
    rows.push(chunk.join(","));
  }

  const repaired = rows.join("\n");
  console.log("[Importer][Grok] Repaired CSV (" + rows.length + " rows):\n" + repaired);
  return repaired;
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
      const repaired = autoRepairCsv(pasteText);
      const lines = repaired.split("\n").map(l => l.trim()).filter(Boolean);
      console.log("[Importer][Grok] Total non-empty lines:", lines.length);

      if (lines.length < 2) {
        setError("Need at least a header row and one data row");
        setImporting(false);
        return;
      }

      // Parse header - support tab or comma
      const delimiter = lines[0].includes("\t") ? "\t" : ",";
      const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
      console.log("[Importer][Grok] Headers:", headers, "Delimiter:", JSON.stringify(delimiter));

      // Find column indices (flexible matching)
      const findCol = (keywords: string[]) =>
        headers.findIndex(h => keywords.some(k => h.toLowerCase().replace(/[^a-z]/g, "").includes(k)));

      const skuIdx = findCol(["sku", "productcode", "code", "itemcode"]);
      const nameIdx = findCol(["name", "product"]);
      const descIdx = findCol(["description", "desc"]);
      const costIdx = findCol(["unitcost", "cost", "nett", "price", "nettprice"]);

      console.log("[Importer][Grok] Column indices - SKU:", skuIdx, "Name:", nameIdx, "Desc:", descIdx, "Cost:", costIdx);

      // Use name col, fallback to first col
      const primaryNameIdx = nameIdx >= 0 ? nameIdx : (skuIdx >= 0 ? (skuIdx === 0 ? 1 : 0) : 0);
      const descriptionIdx = descIdx >= 0 && descIdx !== primaryNameIdx ? descIdx : -1;

      let currentCategory = "";
      const rows: any[] = [];
      const seenSkus = new Set<string>();
      let skippedCount = 0;
      let errorCount = 0;
      let categoryCount = 0;

      for (let i = 1; i < lines.length; i++) {
        // Smart CSV split: respect quoted fields
        const cells: string[] = [];
        let current = "";
        let inQuotes = false;
        for (const ch of lines[i]) {
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === delimiter && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
          current += ch;
        }
        cells.push(current.trim());

        const sku = skuIdx >= 0 ? (cells[skuIdx] || "").trim() : "";
        const name = (cells[primaryNameIdx] || "").trim();
        const descField = descriptionIdx >= 0 ? (cells[descriptionIdx] || "").trim() : "";

        console.log(`[Importer][Grok] Row ${i}: SKU="${sku}" Name="${name}" Desc="${descField}"`);

        // Blank SKU = category header — check name OR description for category text
        if (!sku) {
          const categoryText = name || descField;
          if (categoryText) {
            currentCategory = categoryText;
            categoryCount++;
            console.log(`[Importer][Grok] → Category header set: "${currentCategory}"`);
          } else {
            console.log(`[Importer][Grok] → Skipping blank row`);
            skippedCount++;
          }
          continue;
        }

        if (!name && !descField) {
          console.log(`[Importer][Grok] → Skipping: no name or description`);
          skippedCount++;
          continue;
        }

        // Duplicate SKU check
        if (seenSkus.has(sku.toUpperCase())) {
          console.log(`[Importer][Grok] → Skipping duplicate SKU: ${sku}`);
          skippedCount++;
          continue;
        }
        seenSkus.add(sku.toUpperCase());

        // Parse cost — strip currency prefix (R, R , r), spaces, then parse
        let costRaw = costIdx >= 0 ? (cells[costIdx] || "") : "";
        costRaw = costRaw.replace(/^[Rr]\s*/g, "").trim(); // strip leading R/r + spaces
        costRaw = costRaw.replace(/\s/g, ""); // strip any remaining spaces
        costRaw = costRaw.replace(/,(\d{2})$/, ".$1"); // convert trailing ,XX to .XX
        costRaw = costRaw.replace(/,/g, ""); // strip thousand separators
        const unitCost = parseFloat(costRaw);

        console.log(`[Importer][Grok] → Cost raw="${cells[costIdx]}" cleaned="${costRaw}" parsed=${unitCost}`);

        if (isNaN(unitCost) || unitCost <= 0) {
          console.warn(`[Importer][Grok] → Zero/invalid cost for SKU ${sku}, marking as price-on-request`);
        }

        const productName = name || descField;
        const fullText = `${productName} ${descField}`;
        const specs = parseSpecs(fullText);
        console.log(`[Importer][Grok] → Specs:`, specs);

        const product = {
          supplier_id: supplierId,
          product_code: sku,
          description: productName,
          category: currentCategory || "Uncategorized",
          cost_price: isNaN(unitCost) ? 0 : unitCost,
          selling_price: (!isNaN(unitCost) && unitCost > 0) ? Math.round(unitCost * (1 + markupPercent / 100) * 100) / 100 : 0,
          default_markup_percent: markupPercent,
          btu_rating: specs.btu,
          refrigerant_type: specs.refrigerant,
          pipe_size: specs.pipeLiquid && specs.pipeGas ? `${specs.pipeLiquid} ${specs.pipeGas}` : specs.pipeLiquid || null,
          is_active: true,
          is_price_on_request: isNaN(unitCost) || unitCost <= 0,
        };

        console.log(`[Importer][Grok] → Valid product:`, product);
        rows.push(product);
      }

      console.log(`[Importer][Grok] Parse complete: ${rows.length} products, ${categoryCount} categories, ${skippedCount} skipped`);

      if (rows.length === 0) {
        setError("No valid product rows found. Check that SKU column has data and costs are numeric.");
        setImporting(false);
        return;
      }

      // Batch upsert
      const batchSize = 50;
      let imported = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        console.log(`[Importer][Grok] Upserting batch ${i / batchSize + 1}, size=${batch.length}`);
        const { error: insertError } = await supabase
          .from("supplier_products" as any)
          .upsert(batch as any, { onConflict: "supplier_id,product_code" });
        if (insertError) {
          console.error("[Importer][Grok] Batch upsert failed:", insertError);
          for (const row of batch) {
            const { error: singleErr } = await supabase
              .from("supplier_products" as any)
              .upsert(row as any, { onConflict: "supplier_id,product_code" });
            if (singleErr) {
              console.error(`[Importer][Grok] Single upsert failed for ${row.product_code}:`, singleErr);
              errorCount++;
            } else {
              imported++;
            }
          }
        } else {
          imported += batch.length;
        }
        setProgress(Math.round(((i + batch.length) / rows.length) * 100));
      }

      console.log(`[Importer][Grok] Done: ${imported} imported, ${skippedCount} skipped, ${errorCount} errors`);
      setResult({ imported, skipped: skippedCount, errors: errorCount });
      toast({ title: `${imported} products imported successfully` });
      invalidateAll();
      onComplete();
    } catch (err: any) {
      console.error("[Importer][Grok] Fatal error:", err);
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
                disabled={importing || !pasteText.trim()}
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

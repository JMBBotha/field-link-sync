import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, Check, Sparkles, FileUp, FileText, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

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

/** Load pdf.js from CDN lazily */
let pdfJsLoadPromise: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  if (pdfJsLoadPromise) return pdfJsLoadPromise;
  pdfJsLoadPromise = new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) { resolve((window as any).pdfjsLib); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(lib);
    };
    script.onerror = () => reject(new Error("Failed to load PDF.js"));
    document.head.appendChild(script);
  });
  return pdfJsLoadPromise;
}

interface ParsedRow {
  product_code: string;
  description: string;
  category: string;
  cost_price: number;
  pipe_size: string | null;
  is_price_on_request: boolean;
}

const SupplierProductImporter = ({ supplierId, supplierName, onComplete }: SupplierProductImporterProps) => {
  const [tab, setTab] = useState<"paste" | "ai">("paste");
  const [pasteText, setPasteText] = useState("");
  const [markupPercent, setMarkupPercent] = useState(30);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);

  // AI / PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [extractedText, setExtractedText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [aiMarkup, setAiMarkup] = useState(30);
  const [aiResult, setAiResult] = useState<{ imported: number; updated: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    queryClient.invalidateQueries({ queryKey: ["comparison-products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-from-catalog"] });
  };

  // ─── PDF handling ───
  const handlePdfFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError("PDF file must be under 10 MB");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Only PDF files are accepted");
      return;
    }
    setError(null);
    setPdfFile(file);
    setParsedRows([]);
    setAiResult(null);
    setExtractedText("");
    setExtracting(true);

    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfPageCount(pdf.numPages);

      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(" ");
        fullText += `\n--- Page ${i} ---\n${pageText}`;
      }
      setExtractedText(fullText.trim());
      toast({ title: `PDF loaded: ${pdf.numPages} pages extracted` });
    } catch (err: any) {
      console.error("PDF extraction error:", err);
      setError("Failed to read PDF. Ensure it's a valid, non-password-protected PDF.");
      setPdfFile(null);
    } finally {
      setExtracting(false);
    }
  }, [toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePdfFile(file);
  }, [handlePdfFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePdfFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [handlePdfFile]);

  const clearPdf = () => {
    setPdfFile(null);
    setPdfPageCount(0);
    setExtractedText("");
    setParsedRows([]);
    setAiResult(null);
    setError(null);
  };

  // ─── AI Parse extracted text ───
  const handleAIParse = async () => {
    if (!extractedText.trim()) return;
    setAiParsing(true);
    setError(null);
    setAiResult(null);
    setParsedRows([]);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("parse-price-list", {
        body: { csv_text: extractedText, supplier_id: supplierId, supplier_name: supplierName },
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
      if (lines.length < 2) {
        setError("Need at least a header row and one data row");
        setImporting(false);
        return;
      }
      const delimiter = lines[0].includes("\t") ? "\t" : ",";
      const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
      const findCol = (keywords: string[]) =>
        headers.findIndex(h => keywords.some(k => h.toLowerCase().replace(/[^a-z]/g, "").includes(k)));
      const skuIdx = findCol(["sku", "productcode", "code", "itemcode"]);
      const nameIdx = findCol(["name", "product"]);
      const descIdx = findCol(["description", "desc"]);
      const costIdx = findCol(["unitcost", "cost", "nett", "price", "nettprice"]);
      const primaryNameIdx = nameIdx >= 0 ? nameIdx : (skuIdx >= 0 ? (skuIdx === 0 ? 1 : 0) : 0);
      const descriptionIdx = descIdx >= 0 && descIdx !== primaryNameIdx ? descIdx : -1;
      let currentCategory = "";
      const rows: any[] = [];
      const seenSkus = new Set<string>();
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 1; i < lines.length; i++) {
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
        if (!sku) {
          const categoryText = name || descField;
          if (categoryText) { currentCategory = categoryText; } else { skippedCount++; }
          continue;
        }
        if (!name && !descField) { skippedCount++; continue; }
        if (seenSkus.has(sku.toUpperCase())) { skippedCount++; continue; }
        seenSkus.add(sku.toUpperCase());
        let costRaw = costIdx >= 0 ? (cells[costIdx] || "") : "";
        costRaw = costRaw.replace(/^[Rr]\s*/g, "").trim().replace(/\s/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
        const unitCost = parseFloat(costRaw);
        const productName = name || descField;
        const fullText = `${productName} ${descField}`;
        const specs = parseSpecs(fullText);
        rows.push({
          supplier_id: supplierId, product_code: sku, description: productName,
          category: currentCategory || "Uncategorized", cost_price: isNaN(unitCost) ? 0 : unitCost,
          default_markup_percent: markupPercent, btu_rating: specs.btu,
          refrigerant_type: specs.refrigerant,
          pipe_size: specs.pipeLiquid && specs.pipeGas ? `${specs.pipeLiquid} ${specs.pipeGas}` : specs.pipeLiquid || null,
          is_active: true, is_price_on_request: isNaN(unitCost) || unitCost <= 0,
        });
      }

      if (rows.length === 0) {
        setError("No valid product rows found.");
        setImporting(false);
        return;
      }

      const batchSize = 50;
      let imported = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from("supplier_products" as any)
          .upsert(batch as any, { onConflict: "supplier_id,product_code" });
        if (insertError) {
          for (const row of batch) {
            const { error: singleErr } = await supabase
              .from("supplier_products" as any)
              .upsert(row as any, { onConflict: "supplier_id,product_code" });
            if (singleErr) errorCount++; else imported++;
          }
        } else { imported += batch.length; }
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

          {/* ─── Paste CSV Tab ─── */}
          <TabsContent value="paste" className="space-y-3 mt-3">
            <div>
              <Label className="text-xs font-medium">Paste CSV here</Label>
              <p className="text-[10px] text-muted-foreground mb-1">
                Columns: SKU, Name, Description, Unit Cost — blank SKU rows become category headers
              </p>
              <Textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setResult(null); setError(null); }}
                placeholder={`SKU,Name,Description,Unit Cost\n,,BREEZELESS E R32 INVERTER,\nBZE-INV-09,INVERTER 9000 BTU HEATPUMP MIDWALL - R32,,R 7700.00`}
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
                  type="number" value={markupPercent}
                  onChange={(e) => setMarkupPercent(Number(e.target.value) || 0)}
                  className="w-20 h-8 text-sm" min={0} max={200}
                />
              </div>
              <Button size="sm" onClick={handlePasteImport} disabled={importing || !pasteText.trim()} className="ml-auto">
                {importing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                Import Products
              </Button>
            </div>
          </TabsContent>

          {/* ─── AI PDF Parse Tab ─── */}
          <TabsContent value="ai" className="space-y-3 mt-3">
            {/* Upload zone */}
            {!pdfFile && !extracting && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-primary bg-primary/10" : "border-muted-foreground/30 hover:border-primary/50"
                }`}
              >
                <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium">Drag & drop a PDF price list here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse • Max 10 MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={onFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {/* Extracting spinner */}
            {extracting && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Extracting text from PDF...</p>
              </div>
            )}

            {/* File info + extracted text preview */}
            {pdfFile && !extracting && (
              <>
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-3">
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pdfFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pdfPageCount} page{pdfPageCount !== 1 ? "s" : ""} • {(pdfFile.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearPdf}>
                          <X className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove file</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                {extractedText && (
                  <div>
                    <Label className="text-xs">Extracted Text Preview</Label>
                    <Textarea
                      value={extractedText}
                      readOnly
                      rows={8}
                      className="text-xs font-mono mt-1 bg-muted/30"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {extractedText.length.toLocaleString()} characters extracted
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Markup %</Label>
                    <Input
                      type="number" value={aiMarkup}
                      onChange={(e) => setAiMarkup(Number(e.target.value) || 0)}
                      className="w-20 h-8 text-sm" min={0} max={200}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleAIParse}
                    disabled={aiParsing || !extractedText.trim()}
                    className="ml-auto"
                  >
                    {aiParsing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    {aiParsing ? "Parsing..." : "Parse with AI & Import"}
                  </Button>
                </div>
              </>
            )}

            {aiResult && (
              <div className="bg-primary/10 text-primary p-3 rounded-lg text-sm">
                ✅ {aiResult.imported} imported, {aiResult.updated} updated, {aiResult.skipped} skipped
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Shared status indicators */}
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

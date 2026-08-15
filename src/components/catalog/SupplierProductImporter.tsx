import { useState, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, Check, Sparkles, FileUp, FileText, X, Trash2, ArrowUp, ArrowDown, Minus, RefreshCw, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import PriceConfigPanel, { calculatePrices, type PriceConfig } from "./PriceConfigPanel";
import { buildProductDiff, applyProductDiff, type DiffImportRow, type DiffRow as SharedDiffRow, type DiffAction as SharedDiffAction } from "@/services/diffImportPipeline";

/** Strip non-numeric chars from AI values like "9000 BTU" → 9000 */
function sanitizeInt(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : Math.round(val);
  const n = parseInt(String(val).replace(/[^0-9-]/g, ""));
  return isNaN(n) ? null : n;
}
function sanitizeFloat(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

/** Only allow worded column headers — exclude raw R-amounts */
function isWordedColumnHeader(text: string): boolean {
  const trimmed = (text || "").trim();
  if (!trimmed) return false;
  // Exclude pure price strings like "R7 899", "R1,024.07", "12 699", etc.
  if (/^(R\s*)?[\d\s,]+(\.\s?\d{1,2})?$/i.test(trimmed)) return false;
  // Must contain at least one common price-header keyword
  const HEADER_KEYWORDS = /\b(PRICE|VAT|LIST|EXCL|INCL|INC|NETT|WEBSHOP|CAMPAIGN|RRP|COST|RETAIL|TRADE|DEALER)\b/i;
  if (!HEADER_KEYWORDS.test(trimmed)) return false;
  // Must contain at least one alphabetic word (2+ letters)
  if (!/[A-Za-z]{2,}/.test(trimmed)) return false;
  return true;
}

interface SupplierProductImporterProps {
  supplierId: string;
  supplierName: string;
  isConsumablesSupplier?: boolean;
  onComplete: () => void;
}

/** Auto-repair CSV that was pasted as a single line (no newlines) */
function autoRepairCsv(text: string): string {
  const existingLines = text.split("\n").filter(l => l.trim());
  if (existingLines.length > 1) return text;

  let t = text.replace(/(\d{2,}\.\d{2})([A-Z])/g, "$1,$2");
  const allValues: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of t) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { allValues.push(current); current = ""; continue; }
    current += ch;
  }
  allValues.push(current);

  let numCols = 4;
  const headerEndIdx = allValues.findIndex((v, i) =>
    i > 0 && /unit\s*cost|nett.*price|cost.*price/i.test(v.trim())
  );
  if (headerEndIdx > 0) numCols = headerEndIdx + 1;

  const rows: string[] = [];
  for (let i = 0; i < allValues.length; i += numCols) {
    const chunk = allValues.slice(i, i + numCols);
    while (chunk.length < numCols) chunk.push("");
    rows.push(chunk.join(","));
  }
  return rows.join("\n");
}

/** Parse specs from description text */
function parseSpecs(text: string) {
  const refrigerantMatch = text.match(/R(32|410A|22|290)/i);
  const refrigerant = refrigerantMatch ? `R${refrigerantMatch[1].toUpperCase()}` : null;
  let btu: number | null = null;
  const btuExplicit = text.match(/(\d{4,6})\s*BTU/i);
  if (btuExplicit) { btu = parseInt(btuExplicit[1]); }
  else {
    const btuImplied = text.match(/\b(9|12|18|24|36|48|60)\s*(?:000|k)\b/i);
    if (btuImplied) { const n = parseInt(btuImplied[1]); btu = n < 100 ? n * 1000 : n; }
  }
  let mounting: string | null = null;
  const mountMatch = text.match(/\b(midwall|wall|cassette|floor|ceiling|duct|ducted|portable|concealed)\b/i);
  if (mountMatch) mounting = mountMatch[1].charAt(0).toUpperCase() + mountMatch[1].slice(1).toLowerCase();
  if (mounting === "Midwall") mounting = "Wall";
  if (mounting === "Ducted") mounting = "Duct";
  let pipeLiquid: string | null = null;
  let pipeGas: string | null = null;
  const pipeMatch = text.match(/(\d+\/\d+)\s*[\s&,-]+\s*(\d+\/\d+)/);
  if (pipeMatch) { pipeLiquid = pipeMatch[1]; pipeGas = pipeMatch[2]; }
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

// ParsedRow/DiffRow/DiffAction are the same shape used by every safe import
// entry point — defined once in `@/services/diffImportPipeline` and re-used
// here under the original local names to avoid a large rename.
type ParsedRow = DiffImportRow;
type DiffAction = SharedDiffAction;
type DiffRow = SharedDiffRow;

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const SupplierProductImporter = ({ supplierId, supplierName, isConsumablesSupplier, onComplete }: SupplierProductImporterProps) => {
  const [tab, setTab] = useState<"paste" | "ai">("paste");
  const [pasteText, setPasteText] = useState("");
  const [markupPercent, setMarkupPercent] = useState(30);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number; updated?: number; archived?: number } | null>(null);

  // AI / PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [extractedText, setExtractedText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [diffRows, setDiffRows] = useState<DiffRow[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [aiMarkup, setAiMarkup] = useState(30);
  // Whether the uploaded file is the supplier's full current price list
  // (default) vs. a partial/delta file (e.g. only price changes). Full
  // catalogue files archive any active product missing from the diff;
  // delta files never archive, since absence from a small file isn't
  // evidence a product was discontinued.
  const [isFullCatalogue, setIsFullCatalogue] = useState(true);
  const [aiResult, setAiResult] = useState<{ imported: number; updated: number; skipped: number; archived: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importingDiff, setImportingDiff] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Price config state
  const [showPriceConfig, setShowPriceConfig] = useState(false);
  const [detectedPriceColumns, setDetectedPriceColumns] = useState<string[]>([]);
  const [rawParsedProducts, setRawParsedProducts] = useState<any[]>([]);
  const [priceConfig, setPriceConfig] = useState<PriceConfig | null>(null);

  // Load saved supplier config
  const { data: supplierConfig } = useQuery({
    queryKey: ["supplier-config", supplierId],
    queryFn: async () => {
      const { data } = await supabase
        .from("suppliers" as any)
        .select("default_price_column, price_includes_vat, price_includes_markup, supplier_markup_percent, supplier_discount_percent, default_vat_rate")
        .eq("id", supplierId)
        .single();
      return data as any;
    },
  });

  // Check for stored PDF pages for this supplier
  const { data: storedPdfPages = [] } = useQuery({
    queryKey: ["stored-pdf-pages", supplierName],
    queryFn: async () => {
      // supplier_pdf_pages uses supplier name as supplier_id (text field)
      // supplier_pdf_pages.supplier_id is TEXT, so use ilike for flexible matching
      const { data, error: fetchErr } = await (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, pdf_storage_path")
        .ilike("supplier_id", `%${supplierName}%`)
        .order("page_number");
      if (fetchErr) console.warn("[Stored PDF query]", fetchErr.message);
      return (data || []) as { id: string; supplier_id: string; pdf_filename: string; page_number: number; pdf_storage_path: string | null }[];
    },
  });

  // Get unique PDF storage path from stored pages
  const storedPdfUrl = useMemo(() => {
    const withPath = storedPdfPages.filter(p => p.pdf_storage_path);
    if (withPath.length === 0) return null;
    return withPath[0].pdf_storage_path;
  }, [storedPdfPages]);

  const storedPageCount = storedPdfPages.length;

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    queryClient.invalidateQueries({ queryKey: ["comparison-products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-from-catalog"] });
    queryClient.invalidateQueries({ queryKey: ["import-history"] });
  };

  // ─── Extract from stored PDF ───
  const handleExtractFromStoredPdf = useCallback(async () => {
    if (!storedPdfUrl) return;
    setError(null);
    setParsedRows([]);
    setDiffRows([]);
    setShowDiff(false);
    setAiResult(null);
    setExtractedText("");
    setExtracting(true);
    setPdfFile(null);

    try {
      console.log("[Stored PDF] Loading pdfjs-dist...");
      const pdfjsLib = await loadPdfJs();
      console.log("[Stored PDF] Fetching PDF from:", storedPdfUrl);

      const pdf = await pdfjsLib.getDocument({
        url: storedPdfUrl,
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
        cMapPacked: true,
      }).promise;

      console.log(`[Stored PDF] PDF loaded, ${pdf.numPages} pages`);
      setPdfPageCount(pdf.numPages);

      let fullText = "";
      const Y_TOLERANCE = 2;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const textItems = (content.items as any[]).filter((item: any) => item.str && item.transform);
        const rowMap = new Map<number, { str: string; x: number }[]>();
        for (const item of textItems) {
          const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
          if (!rowMap.has(y)) rowMap.set(y, []);
          rowMap.get(y)!.push({ str: item.str, x: item.transform[4] });
        }
        const sortedRows = Array.from(rowMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) => items);
        let pageText = "";
        for (const rowItems of sortedRows) {
          const sorted = rowItems.sort((a, b) => a.x - b.x);
          pageText += sorted.map(it => it.str.trim()).filter(Boolean).join("\t") + "\n";
        }
        fullText += `\n--- Page ${i} ---\n${pageText}`;
      }

      const trimmed = fullText.trim();
      setExtractedText(trimmed);

      const lines = trimmed.split("\n");
      const productRows = lines.filter(l => l.includes("\t") && /R\s*\d/.test(l));
      console.log(`[Stored PDF] ${trimmed.length} chars, ${pdf.numPages} pages, ~${productRows.length} product rows detected`);
      toast({
        title: `Stored PDF loaded: ${pdf.numPages} pages, ${trimmed.length.toLocaleString()} chars`,
        description: `~${productRows.length} product-like rows detected. Click "Parse with AI" to extract products.`,
      });
    } catch (err: any) {
      console.error("[Stored PDF] Failed:", err);
      setError(`Failed to extract from stored PDF: ${err.message}`);
    } finally {
      setExtracting(false);
    }
  }, [storedPdfUrl, toast]);

  // ─── PDF handling ───
  const handlePdfFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setError("PDF file must be under 10 MB"); return; }
    if (file.type !== "application/pdf") { setError("Only PDF files are accepted"); return; }
    setError(null); setPdfFile(file); setParsedRows([]); setDiffRows([]); setShowDiff(false);
    setAiResult(null); setExtractedText(""); setExtracting(true);
    try {
      console.log("[PDF Import] Loading pdfjs-dist...");
      const pdfjsLib = await loadPdfJs();
      console.log("[PDF Import] Reading file...");
      const arrayBuffer = await file.arrayBuffer();
      console.log(`[PDF Import] Got ArrayBuffer, size: ${arrayBuffer.byteLength}`);
      console.log("[PDF Import] Loading PDF with pdfjs...");
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      console.log(`[PDF Import] PDF loaded, pages: ${pdf.numPages}`);
      setPdfPageCount(pdf.numPages);
      let fullText = "";
      const Y_TOLERANCE = 2;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const textItems = (content.items as any[]).filter((item: any) => item.str && item.transform);
        const rowMap = new Map<number, { str: string; x: number }[]>();
        for (const item of textItems) {
          const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
          if (!rowMap.has(y)) rowMap.set(y, []);
          rowMap.get(y)!.push({ str: item.str, x: item.transform[4] });
        }
        const sortedRows = Array.from(rowMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) => items);
        let pageText = "";
        for (const rowItems of sortedRows) {
          const sorted = rowItems.sort((a, b) => a.x - b.x);
          pageText += sorted.map(it => it.str.trim()).filter(Boolean).join("\t") + "\n";
        }
        fullText += `\n--- Page ${i} ---\n${pageText}`;
      }
      const trimmed = fullText.trim();
      setExtractedText(trimmed);
      // Progress logging: count product-like rows
      const lines = trimmed.split("\n");
      const productRows = lines.filter(l => l.includes("\t") && /R\s*\d/.test(l));
      console.log(`[PDF Extract] ${trimmed.length} chars, ${pdf.numPages} pages, ~${productRows.length} product rows detected`);
      toast({ title: `PDF loaded: ${pdf.numPages} pages, ${trimmed.length.toLocaleString()} chars`, description: `~${productRows.length} product-like rows detected` });

      // Immediately capture PDF pages for Visual Catalog (don't wait for full AI parse)
      import("@/lib/pdfPageCapture").then(async ({ capturePdfPages }) => {
        try {
          console.log("[PDF Import] Capturing pages for visual catalog...");
          const captureResult = await capturePdfPages(file, supplierName, undefined);
          console.log(`[PDF Import] Captured ${captureResult.pagesStored} pages`);
          toast({ title: "Visual Catalog Ready", description: `Stored ${captureResult.pagesStored} page images from ${file.name}` });
          queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
          queryClient.invalidateQueries({ queryKey: ["visual-panel-suppliers"] });
          queryClient.invalidateQueries({ queryKey: ["stored-pdf-pages", supplierName] });
        } catch (captureErr) {
          console.error("[PDF Import] Page capture failed (non-blocking):", captureErr);
        }
      });
    } catch (err: any) {
      console.error("[PDF Import] Failed to read PDF:", err);
      setError("Failed to read PDF. Ensure it's a valid, non-password-protected PDF.");
      setPdfFile(null);
    } finally { setExtracting(false); }
  }, [toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePdfFile(file);
  }, [handlePdfFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePdfFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [handlePdfFile]);

  const clearPdf = () => {
    setPdfFile(null); setPdfPageCount(0); setExtractedText(""); setParsedRows([]);
    setDiffRows([]); setShowDiff(false); setAiResult(null); setError(null);
  };

  // ─── Build diff against existing catalog ───
  // Delegates to the shared `buildProductDiff` used by every safe import entry point.
  const buildDiff = async (incoming: ParsedRow[]): Promise<DiffRow[]> => {
    return buildProductDiff(supplierId, incoming);
  };

  // ─── AI Parse extracted text ───
  const handleAIParse = async () => {
    if (!extractedText.trim()) return;
    setAiParsing(true);
    setError(null);
    setAiResult(null);
    setParsedRows([]);
    setDiffRows([]);
    setShowDiff(false);
    setShowPriceConfig(false);

    const MAX_PAYLOAD_SIZE = 200000;
    const truncatedText =
      extractedText.length > MAX_PAYLOAD_SIZE
        ? extractedText.substring(0, MAX_PAYLOAD_SIZE)
        : extractedText;

    const CHUNK_SIZE = 6000;
    const splitIntoChunks = (text: string, chunkSize: number): string[] => {
      const chunks: string[] = [];
      let i = 0;
      while (i < text.length) {
        let end = Math.min(i + chunkSize, text.length);
        // Try to break at a newline to avoid splitting a product row
        if (end < text.length) {
          const lastNewline = text.lastIndexOf("\n", end);
          if (lastNewline > i + chunkSize * 0.5) end = lastNewline + 1;
        }
        chunks.push(text.substring(i, end));
        i = end;
      }
      return chunks;
    };

    const invokeAI = async (chunkText: string, chunkIndex: number, chunkTotal: number) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout (overall parsing)
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-pdf-with-grok`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              extracted_text: chunkText,
              supplier_id: supplierId,
              supplier_name: supplierName,
              supplier_type: isConsumablesSupplier ? "consumables" : "ac_units",
              markup_percent: aiMarkup,
              chunk_index: chunkIndex,
              chunk_total: chunkTotal,
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`AI parser returned ${resp.status}: ${errText.substring(0, 300)}`);
        }
        return await resp.json();
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err?.name === "AbortError") {
          throw new Error(
            "Request timed out after 5 minutes. The AI parser may still be processing—try again."
          );
        }
        // Browser fetch will throw TypeError on connection resets/timeouts.
        if (err instanceof TypeError && /failed to fetch/i.test(err.message || "")) {
          throw new Error(
            "Network error calling the AI parser (the backend may have timed out). Try again."
          );
        }
        throw err;
      }
    };

    const invokeAIWithRetry = async (chunkText: string, chunkIndex: number, chunkTotal: number) => {
      try {
        return await invokeAI(chunkText, chunkIndex, chunkTotal);
      } catch (firstErr: any) {
        console.error("[AI Parse] Chunk first attempt failed:", { chunkIndex, err: firstErr });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          return await invokeAI(chunkText, chunkIndex, chunkTotal);
        } catch (retryErr: any) {
          console.error("[AI Parse] Chunk retry also failed:", { chunkIndex, err: retryErr });
          throw retryErr;
        }
      }
    };

    try {
      const chunks = splitIntoChunks(truncatedText, CHUNK_SIZE);

      const allCols = new Set<string>();
      const allProducts: any[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkData = await invokeAIWithRetry(chunks[i], i, chunks.length);
        const cols: string[] = chunkData?.detected_price_columns || [];
        const products: any[] = chunkData?.products || [];
        cols.forEach((c) => allCols.add(c));
        allProducts.push(...products);
      }

      // Merge + dedupe by product_code (keep first)
      const seen = new Set<string>();
      const mergedProducts = allProducts.filter((p) => {
        const key = String(p?.product_code || "").toLowerCase();
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Also collect any price keys from products
      for (const p of mergedProducts) {
        if (p?.prices) for (const k of Object.keys(p.prices)) allCols.add(k);
      }

      const columns: string[] = [...allCols].filter(isWordedColumnHeader);
      const products = mergedProducts;

      if (columns.length > 0) {
        setDetectedPriceColumns(columns);
        setRawParsedProducts(products);
        setShowPriceConfig(true);
        toast({
          title: `AI parsed ${products.length} products`,
          description: `Found ${columns.length} price column(s). Configure pricing next.`,
        });
      } else {
        const rows: ParsedRow[] = products.map((p: any) => ({
          product_code: p.product_code || "",
          description: p.description || "",
          category: p.category || "Uncategorized",
          cost_price: p.cost_price || 0,
          pipe_size: p.pipe_size || null,
          btu_rating: sanitizeInt(p.btu_rating),
          refrigerant_type: p.refrigerant_type || null,
          is_price_on_request: p.is_price_on_request || false,
          short_name: p.short_name || null,
          sold_in_length: p.sold_in_length || false,
          unit_length: p.unit_length || null,
          unit_length_unit: p.unit_length_unit || "m",
          price_per_metre: p.price_per_metre || null,
          min_cut_length: p.min_cut_length || 0.5,
          brand: p.brand || null,
          product_category: p.product_category || (isConsumablesSupplier ? "Consumables" : "Air Conditioning"),
        }));
        setParsedRows(rows);
        const diff = await buildDiff(rows);
        setDiffRows(diff);
        setShowDiff(true);
        toast({
          title: `AI parsed ${rows.length} products`,
          description: "Review the diff below before importing",
        });
      }
    } catch (err: any) {
      console.error("[AI Parse] Final error:", err);
      setError(err.message || "AI parsing failed");
      toast({ title: "AI Parse Failed", description: err.message, variant: "destructive" });
    } finally {
      setAiParsing(false);
    }
  };


  // ─── Price Config confirmed → build diff ───
  const handlePriceConfigConfirm = async (config: PriceConfig) => {
    setPriceConfig(config);
    setAiMarkup(config.yourMarkupPercent);

    // Save config to supplier for next time
    await supabase.from("suppliers" as any).update({
      default_price_column: config.selectedPriceColumn,
      price_includes_vat: config.priceIncludesVat,
      price_includes_markup: config.priceIncludesMarkup,
      supplier_markup_percent: config.supplierMarkupPercent,
      supplier_discount_percent: config.supplierDiscountPercent,
      default_vat_rate: config.vatRate,
    } as any).eq("id", supplierId);

    // Calculate true cost for each product using selected price column
    const rows: ParsedRow[] = rawParsedProducts.map((p: any) => {
      const prices = p.prices || {};
      const rawPrice = prices[config.selectedPriceColumn] || p.cost_price || 0;
      const calculated = calculatePrices(rawPrice, config);

      // Find RRP if available (use a different column than selected)
      let rrp: number | null = null;
      for (const col of Object.keys(prices)) {
        if (col.toLowerCase().includes("rrp") || col.toLowerCase().includes("retail") || col.toLowerCase().includes("list")) {
          if (col !== config.selectedPriceColumn) {
            rrp = prices[col];
            break;
          }
        }
      }

      // Compute consumable length fields
      const soldInLength = p.sold_in_length || false;
      const unitLength = p.unit_length || null;
      const pricePerMetre = soldInLength && unitLength && calculated.trueCost > 0
        ? Math.round((calculated.trueCost / unitLength) * 100) / 100
        : (p.price_per_metre || null);

      return {
        product_code: p.product_code || "",
        description: p.description || "",
        category: p.category || "Uncategorized",
        cost_price: calculated.trueCost,
        pipe_size: p.pipe_size || null,
        btu_rating: sanitizeInt(p.btu_rating),
        refrigerant_type: p.refrigerant_type || null,
        is_price_on_request: rawPrice <= 0,
        short_name: p.short_name || null,
        sold_in_length: soldInLength,
        unit_length: unitLength,
        unit_length_unit: p.unit_length_unit || "m",
        price_per_metre: pricePerMetre,
        min_cut_length: p.min_cut_length || 0.5,
        brand: p.brand || null,
        product_category: p.product_category || (isConsumablesSupplier ? "Consumables" : "Air Conditioning"),
        // Extra price data stored for import
        cost_excl_vat: calculated.costExclVat,
        cost_incl_vat: calculated.costInclVat,
        _rrp: rrp,
        supplier_discount_percent: config.supplierDiscountPercent,
        vat_rate: config.vatRate,
      } as any;
    });

    setParsedRows(rows);
    const diff = await buildDiff(rows);
    setDiffRows(diff);
    setShowPriceConfig(false);
    setShowDiff(true);
  };

  // ─── Apply diff import ───
  const handleApplyDiff = async (forceAll = false) => {
    setImportingDiff(true); setError(null); setProgress(0);

    const workingRowsPreview = forceAll
      ? diffRows.map(r => r.action === "unchanged" ? { ...r, action: "update" as DiffAction } : r)
      : diffRows;
    const archiveRowsPreview = isFullCatalogue ? workingRowsPreview.filter(r => r.action === "archive") : [];
    const totalPreview = workingRowsPreview.filter(r => r.action === "new" || r.action === "update" || r.action === "restore" || (isFullCatalogue && r.action === "archive")).length;
    if (totalPreview === 0) {
      toast({ title: "Nothing to apply", description: "All products are unchanged. Use 'Force Re-import All' to refresh all products.", variant: "destructive" });
      setImportingDiff(false); return;
    }

    try {
      // Delegates to the shared diff-apply logic used by every safe import entry point.
      const { imported, updated, archived, errors, firstError } = await applyProductDiff({
        supplierId,
        supplierName,
        diffRows,
        forceAll,
        isConsumablesSupplier,
        defaultMarkupPercent: aiMarkup,
        fileName: pdfFile?.name || "AI Import",
        onProgress: setProgress,
        isFullCatalogue,
      });

      if (errors > 0 && archiveRowsPreview.length > 0) {
        toast({
          title: "Archive skipped",
          description: `${archiveRowsPreview.length} products were NOT archived because ${errors} errors occurred during insert/update. Fix errors first.`,
          variant: "destructive",
        });
      }

      // Capture PDF pages for visual catalog (only if not already captured in handlePdfFile)
      if (pdfFile && storedPdfPages.length === 0) {
        import("@/lib/pdfPageCapture").then(async ({ capturePdfPages, matchProductsToPdfPages }) => {
          try {
            const captureResult = await capturePdfPages(pdfFile, supplierName, undefined);
            toast({ title: `Visual Catalog`, description: `Stored ${captureResult.pagesStored} pages from ${pdfFile.name}` });
            queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
            queryClient.invalidateQueries({ queryKey: ["visual-panel-suppliers"] });
            queryClient.invalidateQueries({ queryKey: ["stored-pdf-pages", supplierName] });
            const importedCodes = diffRows.filter(r => r.action === "new" || r.action === "update").map(r => r.product_code);
            if (importedCodes.length > 0) {
              await matchProductsToPdfPages(supplierName, pdfFile.name, importedCodes);
            }
          } catch (err) {
            console.error("[PDF Capture] Error:", err);
          }
        });
      } else if (pdfFile) {
        // Pages already captured — just match products to existing pages
        import("@/lib/pdfPageCapture").then(async ({ matchProductsToPdfPages }) => {
          try {
            const importedCodes = diffRows.filter(r => r.action === "new" || r.action === "update").map(r => r.product_code);
            if (importedCodes.length > 0) {
              await matchProductsToPdfPages(supplierName, pdfFile.name, importedCodes);
            }
          } catch (err) {
            console.error("[PDF Match] Error:", err);
          }
        });
      }

      setAiResult({ imported, updated, skipped: errors, archived });
      setShowDiff(false);
      if (errors > 0) {
        toast({
          title: "Import failed",
          description: `${imported} new, ${updated} updated, ${archived} archived, ${errors} FAILED. Error: ${firstError.substring(0, 120)}`,
          variant: "destructive",
        });
        setError(`Import had ${errors} errors. First error: ${firstError}`);
      } else {
        toast({ title: "Import Complete", description: `${imported} new, ${updated} updated, ${archived} archived` });
      }
      invalidateAll();
      onComplete();
    } catch (err: any) {
      setError(err.message || "Import failed");
      toast({ title: "Import crashed", description: err.message, variant: "destructive" });
    } finally { setImportingDiff(false); }
  };

  // ─── Remove row from diff ───
  const removeDiffRow = (idx: number) => {
    setDiffRows(prev => prev.filter((_, i) => i !== idx));
  };

  // ─── Edit diff row ───
  const updateDiffRow = (idx: number, field: keyof ParsedRow, value: any) => {
    setDiffRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  /** Parse pasted CSV text with category-header detection */
  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;
    setImporting(true); setProgress(0); setError(null); setResult(null);
    try {
      const repaired = autoRepairCsv(pasteText);
      const lines = repaired.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { setError("Need at least a header row and one data row"); setImporting(false); return; }
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
        let curr = ""; let inQ = false;
        for (const ch of lines[i]) {
          if (ch === '"') { inQ = !inQ; continue; }
          if (ch === delimiter && !inQ) { cells.push(curr.trim()); curr = ""; continue; }
          curr += ch;
        }
        cells.push(curr.trim());
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
          archived: false,
        });
      }

      if (rows.length === 0) { setError("No valid product rows found."); setImporting(false); return; }

      const batchSize = 50;
      let imported = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error: insertError } = await supabase.from("supplier_products" as any)
          .upsert(batch as any, { onConflict: "supplier_id,product_code" });
        if (insertError) {
          for (const row of batch) {
            const { error: singleErr } = await supabase.from("supplier_products" as any)
              .upsert(row as any, { onConflict: "supplier_id,product_code" });
            if (singleErr) errorCount++; else imported++;
          }
        } else { imported += batch.length; }
        setProgress(Math.round(((i + batch.length) / rows.length) * 100));
      }

      setResult({ imported, skipped: skippedCount, errors: errorCount });
      toast({ title: `${imported} products imported successfully` });
      invalidateAll(); onComplete();
    } catch (err: any) {
      setError(err.message || "Import failed");
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    } finally { setImporting(false); }
  };

  const lineCount = pasteText.split("\n").filter(l => l.trim()).length;

  // Diff summary counts
  const diffSummary = {
    new: diffRows.filter(r => r.action === "new").length,
    update: diffRows.filter(r => r.action === "update").length,
    archive: diffRows.filter(r => r.action === "archive").length,
    unchanged: diffRows.filter(r => r.action === "unchanged").length,
    restore: diffRows.filter(r => r.action === "restore").length,
  };

  // Brand summary from parsed rows
  const brandSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of diffRows) {
      if (row.action === "archive") continue;
      const brand = (row as any).brand || "Unknown";
      counts[brand] = (counts[brand] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [diffRows]);

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
                rows={10} className="text-xs font-mono"
              />
              {lineCount > 1 && <p className="text-[10px] text-muted-foreground mt-1">{lineCount} lines detected</p>}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Markup %</Label>
                <Input type="number" value={markupPercent} onChange={(e) => setMarkupPercent(Number(e.target.value) || 0)}
                  className="w-20 h-8 text-sm" min={0} max={200} />
              </div>
              <Button size="sm" onClick={handlePasteImport} disabled={importing || !pasteText.trim()} className="ml-auto">
                {importing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                Import Products
              </Button>
            </div>
          </TabsContent>

          {/* ─── AI PDF Parse Tab ─── */}
          <TabsContent value="ai" className="space-y-3 mt-3">
            {/* Stored PDF extraction option */}
            {!pdfFile && !extracting && !showDiff && !showPriceConfig && !extractedText && storedPageCount > 0 && storedPdfUrl && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Stored PDF Available</p>
                    <p className="text-xs text-muted-foreground">
                      {storedPageCount} page{storedPageCount !== 1 ? "s" : ""} already stored from a previous upload for {supplierName}.
                      Extract products without re-uploading.
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={handleExtractFromStoredPdf} className="w-full gap-2">
                  <Sparkles className="h-3.5 w-3.5" />
                  Extract Products from Stored PDF ({storedPageCount} pages)
                </Button>
              </div>
            )}

            {!pdfFile && !extracting && !showDiff && !extractedText && (
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
                <p className="text-sm font-medium">{storedPageCount > 0 ? "Or drag & drop a new PDF" : "Drag & drop a PDF price list here"}</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse • Max 10 MB</p>
                <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={onFileSelect} className="hidden" />
              </div>
            )}

            {extracting && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Extracting text from PDF...</p>
              </div>
            )}

            {(pdfFile || extractedText) && !extracting && !showDiff && !showPriceConfig && (
              <>
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-3">
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pdfFile?.name || `${supplierName} Stored PDF`}</p>
                    <p className="text-xs text-muted-foreground">
                      {pdfPageCount} page{pdfPageCount !== 1 ? "s" : ""}{pdfFile ? ` • ${(pdfFile.size / 1024).toFixed(0)} KB` : " • from stored catalog"}
                    </p>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearPdf}>
                          <X className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>


                {extractedText && (
                  <div className="space-y-2">
                    <Label className="text-xs">Extraction Summary</Label>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{extractedText.length.toLocaleString()} chars</Badge>
                      <Badge variant="secondary">{pdfPageCount} pages</Badge>
                      <Badge variant="secondary">
                        ~{extractedText.split("\n").filter(l => l.includes("\t") && /R\s*\d/.test(l)).length} product rows
                      </Badge>
                    </div>
                    <Textarea value={extractedText.substring(0, 2000) + (extractedText.length > 2000 ? "\n... (truncated preview)" : "")} readOnly rows={6} className="text-xs font-mono mt-1 bg-muted/30" />
                    <details className="text-xs">
                      <summary className="cursor-pointer text-primary hover:underline">Show Full Extracted Text ({extractedText.length.toLocaleString()} chars)</summary>
                      <Textarea value={extractedText} readOnly rows={20} className="text-xs font-mono mt-1 bg-muted/30 w-full" />
                    </details>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Markup %</Label>
                    <Input type="number" value={aiMarkup} onChange={(e) => setAiMarkup(Number(e.target.value) || 0)}
                      className="w-20 h-8 text-sm" min={0} max={200} />
                  </div>
                  <Button size="sm" onClick={handleAIParse} disabled={aiParsing || !extractedText.trim()} className="ml-auto">
                    {aiParsing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    {aiParsing ? "Parsing..." : "Parse with AI"}
                  </Button>
                </div>
              </>
            )}

            {/* ─── Price Configuration Step ─── */}
            {showPriceConfig && detectedPriceColumns.length > 0 && (
              <PriceConfigPanel
                detectedPriceColumns={detectedPriceColumns}
                samplePrices={rawParsedProducts[0]?.prices || {}}
                savedConfig={supplierConfig ? {
                  selectedPriceColumn: supplierConfig.default_price_column || detectedPriceColumns[0],
                  priceIncludesVat: supplierConfig.price_includes_vat || false,
                  priceIncludesMarkup: supplierConfig.price_includes_markup || false,
                  supplierMarkupPercent: supplierConfig.supplier_markup_percent || 0,
                  supplierDiscountPercent: supplierConfig.supplier_discount_percent || 0,
                  vatRate: supplierConfig.default_vat_rate || 15,
                  yourMarkupPercent: aiMarkup,
                } : undefined}
                onConfirm={handlePriceConfigConfirm}
                onBack={() => { setShowPriceConfig(false); setRawParsedProducts([]); }}
              />
            )}

            {/* ─── Diff Preview ─── */}
            {showDiff && diffRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Import Preview</h3>
                  <Button variant="ghost" size="sm" onClick={() => { setShowDiff(false); setDiffRows([]); }}>
                    <X className="h-3 w-3 mr-1" /> Cancel
                  </Button>
                </div>

                {/* Summary badges */}
                <div className="flex flex-wrap gap-2">
                  {diffSummary.new > 0 && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                      <ArrowUp className="h-3 w-3 mr-1" /> {diffSummary.new} New
                    </Badge>
                  )}
                  {diffSummary.update > 0 && (
                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                      <ArrowDown className="h-3 w-3 mr-1" /> {diffSummary.update} Price Updates
                    </Badge>
                  )}
                  {diffSummary.archive > 0 && (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                      <Minus className="h-3 w-3 mr-1" /> {diffSummary.archive} To Archive
                    </Badge>
                  )}
                  {diffSummary.restore > 0 && (
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                      <RotateCcw className="h-3 w-3 mr-1" /> {diffSummary.restore} Restore
                    </Badge>
                  )}
                  {diffSummary.unchanged > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {diffSummary.unchanged} Unchanged
                    </Badge>
                  )}
                </div>

                {/* Brand summary */}
                {brandSummary.length > 0 && (
                  <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-semibold">Brand Detection Summary</p>
                    <div className="flex flex-wrap gap-2">
                      {brandSummary.map(([brand, count]) => (
                        <Badge key={brand} variant="outline" className="text-xs gap-1">
                          {brand}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="max-h-80 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="text-left p-2 font-medium">SKU</th>
                        <th className="text-left p-2 font-medium">Description</th>
                        <th className="text-left p-2 font-medium">Category</th>
                         <th className="text-right p-2 font-medium">Cost</th>
                        {isConsumablesSupplier && <th className="text-right p-2 font-medium">Per Metre</th>}
                        <th className="p-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows.filter(r => r.action !== "unchanged").map((row, idx) => (
                        <tr key={idx} className={`border-t border-border ${
                          row.action === "new" ? "bg-emerald-500/5" :
                          row.action === "update" ? "bg-amber-500/5" :
                          row.action === "restore" ? "bg-blue-500/5" :
                          row.action === "archive" ? "bg-red-500/5" : ""
                        }`}>
                          <td className="p-2">
                            <Badge variant="outline" className={`text-[10px] ${
                              row.action === "new" ? "border-emerald-500/50 text-emerald-400" :
                              row.action === "update" ? "border-amber-500/50 text-amber-400" :
                              row.action === "restore" ? "border-blue-500/50 text-blue-400" :
                              "border-red-500/50 text-red-400"
                            }`}>
                              {row.action === "new" ? "NEW" : row.action === "update" ? "UPDATE" : row.action === "restore" ? "RESTORE" : "ARCHIVE"}
                            </Badge>
                          </td>
                          <td className="p-2 font-mono">{row.product_code}</td>
                          <td className="p-2 max-w-[200px] truncate">
                            {row.action !== "archive" ? (
                              <Input value={row.description} onChange={(e) => updateDiffRow(
                                diffRows.indexOf(row), "description", e.target.value
                              )} className="h-6 text-xs p-1 bg-transparent border-none" />
                            ) : (
                              <span className="line-through text-muted-foreground">{row.description}</span>
                            )}
                          </td>
                          <td className="p-2">
                            {row.action !== "archive" ? (
                              <Input value={row.category} onChange={(e) => updateDiffRow(
                                diffRows.indexOf(row), "category", e.target.value
                              )} className="h-6 text-xs p-1 bg-transparent border-none w-28" />
                            ) : row.category}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            {row.action === "update" && row.old_cost_price !== undefined ? (
                              <div>
                                <span className="line-through text-muted-foreground mr-1">{formatZAR(row.old_cost_price)}</span>
                                <span className="text-amber-400 font-semibold">{formatZAR(row.cost_price)}</span>
                              </div>
                            ) : row.action === "archive" ? (
                              <span className="text-muted-foreground">{formatZAR(row.cost_price)}</span>
                            ) : (
                              <span className="text-emerald-400 font-semibold">{formatZAR(row.cost_price)}</span>
                            )}
                          </td>
                          {isConsumablesSupplier && (
                            <td className="p-2 text-right whitespace-nowrap">
                              {row.sold_in_length && row.price_per_metre ? (
                                <span className="text-primary font-semibold text-[10px]">
                                  {formatZAR(row.price_per_metre)}/m
                                  <span className="text-muted-foreground font-normal ml-1">({row.unit_length}m)</span>
                                </span>
                              ) : "—"}
                            </td>
                          )}
                          <td className="p-2">
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeDiffRow(diffRows.indexOf(row))}>
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Apply button */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Markup %</Label>
                    <Input type="number" value={aiMarkup} onChange={(e) => setAiMarkup(Number(e.target.value) || 0)}
                      className="w-20 h-8 text-sm" min={0} max={200} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="is-full-catalogue" checked={isFullCatalogue} onCheckedChange={setIsFullCatalogue} />
                    <Label htmlFor="is-full-catalogue" className="text-xs whitespace-nowrap cursor-pointer">
                      Full price list
                      <span className="text-muted-foreground ml-1">
                        {isFullCatalogue ? "(missing items will be archived)" : "(partial file — nothing archived)"}
                      </span>
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    {diffSummary.unchanged > 0 && (
                      <Button size="sm" variant="outline" onClick={() => handleApplyDiff(true)} disabled={importingDiff}>
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Force Re-import All ({diffSummary.unchanged + diffSummary.new + diffSummary.update + diffSummary.restore})
                      </Button>
                    )}
                    <Button size="sm" onClick={() => handleApplyDiff(false)} disabled={importingDiff}>
                      {importingDiff ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                      Apply {diffSummary.new + diffSummary.update + (isFullCatalogue ? diffSummary.archive : 0) + diffSummary.restore} Changes
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {aiResult && (
              <div className="bg-primary/10 text-primary p-3 rounded-lg text-sm">
                ✅ {aiResult.imported} imported, {aiResult.updated} updated, {aiResult.archived} archived, {aiResult.skipped} errors
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Shared status indicators */}
        {(importing || importingDiff) && (
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
            {result.updated ? `, ${result.updated} updated` : ""}
            {result.archived ? `, ${result.archived} archived` : ""}
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplierProductImporter;

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Sparkles, AlertTriangle, RotateCcw, ScanLine } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ImportPreviewModal from "./ImportPreviewModal";
import SupplierInfoReviewModal from "./SupplierInfoReviewModal";
import type { ImportPreview, ParsedProduct, ImportStage } from "@/services/productImportParser";
import type { ExtractedSupplierInfo } from "@/services/supplierInfoExtractor";
import { runImportPipeline } from "@/services/pdfImportPipeline";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2 } from "lucide-react";

interface SupplierImportPanelProps {
  supplierId: string;
  supplierName: string;
  onImportComplete?: () => void;
  compact?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const SupplierImportPanel = ({ supplierId, supplierName, onImportComplete, compact = false }: SupplierImportPanelProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  const [importAnalysing, setImportAnalysing] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importConfirming, setImportConfirming] = useState(false);
  const [showCleanConfirm, setShowCleanConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importStage, setImportStage] = useState<ImportStage | null>(null);
  const [supplierInfoExtracted, setSupplierInfoExtracted] = useState<ExtractedSupplierInfo | null>(null);

  const { data: activeProductCount = 0 } = useQuery({
    queryKey: ["supplier-active-product-count", supplierId],
    queryFn: async () => {
      const { count, error } = await (supabase.from("supplier_products") as any)
        .select("*", { count: "exact", head: true })
        .eq("supplier_id", supplierId)
        .or("archived.is.null,archived.eq.false");
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: pdfCount = 0 } = useQuery({
    queryKey: ["supplier-pdf-count", supplierId],
    queryFn: async () => {
      const { count } = await (supabase.from("pdf_uploads") as any)
        .select("*", { count: "exact", head: true })
        .eq("supplier_id", supplierId);
      return count || 0;
    },
  });

  const { data: lastImport } = useQuery({
    queryKey: ["supplier-last-import", supplierId],
    queryFn: async () => {
      const { data } = await (supabase.from("import_audit_log") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .in("action", ["pdf_import", "csv_import"])
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
  });

  // Check for existing PDF in storage for re-parse — prefer the file that matches
  // the latest successful import; otherwise fall back to the newest file present.
  const { data: storedPdfInfo } = useQuery({
    queryKey: ["supplier-stored-pdf", supplierId, lastImport?.file_name],
    queryFn: async () => {
      const { data: files } = await supabase.storage
        .from("supplier-pdfs")
        .list(supplierId, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
      if (!files || files.length === 0) return null;

      const targetName = lastImport?.file_name as string | undefined;
      const matched = targetName ? files.find((f) => f.name === targetName) : undefined;
      const chosen = matched ?? files[0];

      return {
        path: `${supplierId}/${chosen.name}`,
        fileName: chosen.name,
        matchesLastImport: !!matched,
        totalFiles: files.length,
      };
    },
    enabled: !!supplierId,
  });

  const storedPdfPath = storedPdfInfo?.path ?? null;

  const [reparseLoading, setReparseLoading] = useState(false);
  const [pendingReparse, setPendingReparse] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ page: number; total: number; updated: number } | null>(null);

  const isDaikin = /daikin/i.test(supplierName);

  const handleEnrichOverlays = useCallback(async () => {
    setEnrichLoading(true);
    setEnrichProgress({ page: 0, total: 0, updated: 0 });
    let totalUpdated = 0;
    let page = 1;
    let totalPages = 0;
    try {
      while (true) {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-pdf-bbox-daikin?page=${page}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );
        const result = await resp.json();
        if (!resp.ok) throw new Error(result?.error || `OCR failed on page ${page}`);
        totalPages = result.total_pages || totalPages;
        totalUpdated += result.updated || 0;
        setEnrichProgress({ page, total: totalPages, updated: totalUpdated });
        if (result.done) break;
        page = result.next_page ?? page + 1;
        if (page > 200) break; // safety guard
      }
      toast({
        title: "Overlay enrichment complete",
        description: `Updated ${totalUpdated} products across ${totalPages} pages with bbox coordinates.`,
      });
      invalidateAll();
    } catch (err: any) {
      console.error("[Enrich] failed:", err);
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
    } finally {
      setEnrichLoading(false);
      setEnrichProgress(null);
    }
  }, [toast]);

  const handleCleanupStalePdfs = useCallback(async () => {
    const target = lastImport?.file_name as string | undefined;
    const { data: files } = await supabase.storage
      .from("supplier-pdfs")
      .list(supplierId, { limit: 100 });
    if (!files || files.length === 0) {
      toast({ title: "No PDFs to clean up" });
      return;
    }
    const toRemove = files
      .filter((f) => !target || f.name !== target)
      .map((f) => `${supplierId}/${f.name}`);
    if (toRemove.length === 0) {
      toast({ title: "Storage already clean", description: "Only the latest PDF is present." });
      return;
    }
    const { error } = await supabase.storage.from("supplier-pdfs").remove(toRemove);
    if (error) {
      toast({ title: "Cleanup failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Removed ${toRemove.length} stale PDF${toRemove.length === 1 ? "" : "s"}` });
    queryClient.invalidateQueries({ queryKey: ["supplier-stored-pdf", supplierId] });
  }, [supplierId, lastImport?.file_name, queryClient, toast]);

  const invalidateAll = useCallback(() => {
    const keys = [
      ["supplier-active-product-count", supplierId],
      ["supplier-pdf-count", supplierId],
      ["supplier-last-import", supplierId],
      ["supplier-product-count", supplierId],
      ["supplier-product-counts"],
      ["admin-suppliers-list"],
      ["supplier-products"],
      ["supplier-products-all"],
      ["import-audit-log", supplierId],
      ["quote-builder-products"],
      ["product-category-counts"],
      ["consumable-products"],
    ];
    keys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
  }, [queryClient, supplierId]);

  const validateFile = (file: File): boolean => {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".pdf") && !ext.endsWith(".csv")) {
      toast({ title: "Only PDF or CSV files supported", variant: "destructive" });
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum file size is 10 MB.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !validateFile(file)) {
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }
    if (activeProductCount > 0) {
      setPendingFile(file);
      setShowCleanConfirm(true);
    } else {
      runAnalysis(file);
    }
    if (importInputRef.current) importInputRef.current.value = "";
  }, [activeProductCount]);

  const runAnalysis = useCallback(async (file: File) => {
    setImportAnalysing(true);
    setImportFileName(file.name);
    setImportStage(null);
    pendingFileRef.current = file;
    try {
      const { parseImportFile } = await import("@/services/productImportParser");
      const preview = await parseImportFile(file, supplierId, undefined, (stage) => {
        setImportStage(stage);
      });
      setImportPreview(preview);
    } catch (err: any) {
      console.error("[Import] Analysis failed:", err);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setImportAnalysing(false);
      setImportStage(null);
    }
  }, [supplierId, toast]);

  const handleReparse = useCallback(async () => {
    if (!storedPdfPath) return;
    setReparseLoading(true);
    try {
      const { data: blob, error } = await supabase.storage
        .from("supplier-pdfs")
        .download(storedPdfPath);
      if (error || !blob) throw new Error(error?.message || "Failed to download PDF from storage");
      const fileName = storedPdfPath.split("/").pop() || "stored.pdf";
      const file = new File([blob], fileName, { type: "application/pdf" });
      await runAnalysis(file);
    } catch (err: any) {
      console.error("[Re-parse] Failed:", err);
      toast({ title: "Re-parse failed", description: err.message, variant: "destructive" });
    } finally {
      setReparseLoading(false);
    }
  }, [storedPdfPath, runAnalysis, toast]);

  const handleConfirm = useCallback(async (products: ParsedProduct[]) => {
    setImportConfirming(true);
    try {
      const file = pendingFileRef.current;

      const result = await runImportPipeline({
        supplierId,
        supplierName,
        products,
        file,
      });

      if (!result.success) {
        throw new Error(result.error || "Import pipeline failed");
      }

      if (result.validationWarnings.length > 0) {
        console.warn("[Import] Validation warnings:", result.validationWarnings);
      }

      console.log(`[Import] ✅ Complete — ${result.productsImported} products imported, ${result.productsSkipped} skipped`);
      invalidateAll();
      onImportComplete?.();
      toast({
        title: `✅ ${result.productsImported} products imported`,
        description: `${supplierName} catalog updated.${result.productsSkipped > 0 ? ` ${result.productsSkipped} skipped.` : ""}`,
      });
      setImportPreview(null);

      // Auto-extract supplier contact info from PDF
      if (file && file.name.toLowerCase().endsWith(".pdf")) {
        try {
          const { extractSupplierInfoFromPDF } = await import("@/services/supplierInfoExtractor");
          const info = await extractSupplierInfoFromPDF(file);
          const hasInfo = info.allEmails.length > 0 || info.allPhones.length > 0 ||
            info.vatNumber || info.website || info.departments.length > 0 || info.locations.length > 0;
          if (hasInfo) {
            setSupplierInfoExtracted(info);
          }
        } catch (extractErr) {
          console.warn("[Import] Supplier info extraction failed (non-fatal):", extractErr);
        }
      }

      pendingFileRef.current = null;
    } catch (err: any) {
      console.error("[Import] Failed:", err);
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportConfirming(false);
    }
  }, [supplierId, supplierName, importFileName, invalidateAll, onImportComplete, toast]);

  return (
    <>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        <Card className="border-dashed border-primary/30">
          <CardContent className={compact ? "p-3" : "p-4"}>
            <div className="flex flex-col items-center gap-3 py-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                Import Products — {supplierName}
              </p>

              <input
                ref={importInputRef}
                type="file"
                accept=".pdf,.csv"
                className="hidden"
                onChange={handleFileSelect}
              />

              <div
                className="w-full border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => importInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file && validateFile(file)) {
                    if (activeProductCount > 0) {
                      setPendingFile(file);
                      setShowCleanConfirm(true);
                    } else {
                      runAnalysis(file);
                    }
                  }
                }}
              >
                {importAnalysing ? (
                  <div className="space-y-2 text-left w-full">
                    <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing: {importFileName}
                    </p>
                    {importStage && (
                      <div className="space-y-1.5">
                        {importStage.stage === "loading_pdf" && (
                          <p className="text-xs text-muted-foreground">📄 Loading PDF...</p>
                        )}
                        {importStage.stage === "rendering_pages" && (
                          <>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-500" /> Step 1/4: Rendering pages ({importStage.done}/{importStage.total})
                            </p>
                            <Progress value={(importStage.done / importStage.total) * 25} className="h-1.5" />
                          </>
                        )}
                        {importStage.stage === "enhancing_images" && (
                          <>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-500" /> Step 1/4: Pages rendered ✓
                            </p>
                            <p className="text-xs text-primary flex items-center gap-1">
                              🔄 Step 2/4: Enhancing with Deep-Image.ai ({importStage.done}/{importStage.total})
                            </p>
                            <Progress value={25 + (importStage.done / importStage.total) * 25} className="h-1.5" />
                          </>
                        )}
                        {importStage.stage === "ai_extraction" && (
                          <>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-500" /> Pages rendered & enhanced ✓
                            </p>
                            <p className="text-xs text-primary flex items-center gap-1">
                              🤖 Step 3/4: {importStage.detail}
                            </p>
                            <Progress value={65} className="h-1.5" />
                          </>
                        )}
                        {importStage.stage === "text_fallback" && (
                          <>
                            <p className="text-xs text-muted-foreground">
                              📝 Step 4/4: {importStage.detail}
                            </p>
                            <Progress value={85} className="h-1.5" />
                          </>
                        )}
                        {importStage.stage === "complete" && (
                          <>
                            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> {importStage.detail}
                            </p>
                            <Progress value={100} className="h-1.5" />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">
                      Drag & drop PDF or CSV here
                    </p>
                    <p className="text-xs text-muted-foreground">or click to browse • Max 10 MB</p>
                  </>
                )}
              </div>

              {storedPdfInfo && !importAnalysing && (
                <div className="space-y-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (activeProductCount > 0) {
                        setPendingFile(null);
                        setPendingReparse(true);
                        setShowCleanConfirm(true);
                      } else {
                        handleReparse();
                      }
                    }}
                    disabled={reparseLoading}
                    className="gap-1.5 w-full justify-start"
                  >
                    {reparseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    <span className="truncate">Re-parse: {storedPdfInfo.fileName}</span>
                  </Button>
                  {!storedPdfInfo.matchesLastImport && lastImport?.file_name && (
                    <div className="flex items-start gap-1.5 text-[11px] text-yellow-700 dark:text-yellow-400 px-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>
                        This isn't the most recently imported PDF (
                        <strong className="break-all">{lastImport.file_name}</strong>) — it may be a stale leftover in storage.
                      </span>
                    </div>
                  )}
                  {storedPdfInfo.totalFiles > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCleanupStalePdfs}
                      className="h-6 text-[11px] text-muted-foreground hover:text-destructive gap-1"
                    >
                      Remove {storedPdfInfo.totalFiles - 1} stale PDF{storedPdfInfo.totalFiles - 1 === 1 ? "" : "s"} from storage
                    </Button>
                  )}
                  {isDaikin && (
                    <div className="space-y-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEnrichOverlays}
                        disabled={enrichLoading || activeProductCount === 0}
                        className="gap-1.5 w-full justify-start"
                        title="Use vision OCR to populate row/price bbox coordinates so PDF overlays render in the Quote Builder"
                      >
                        {enrichLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                        <span>Enrich overlay coordinates (vision OCR)</span>
                      </Button>
                      {enrichProgress && (
                        <p className="text-[11px] text-muted-foreground px-1">
                          Page {enrichProgress.page}{enrichProgress.total ? ` / ${enrichProgress.total}` : ""} — {enrichProgress.updated} products updated
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Products: <strong>{activeProductCount}</strong></span>
                <span>PDFs: <strong>{pdfCount}</strong></span>
              </div>

              {activeProductCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-3 w-3" />
                  Uploading will REPLACE all existing products
                </div>
              )}

              {lastImport && (
                <p className="text-[11px] text-muted-foreground">
                  Last import: {new Date(lastImport.created_at).toLocaleDateString()} — {lastImport.products_imported} products from {lastImport.file_name}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clean confirmation */}
      <AlertDialog open={showCleanConfirm} onOpenChange={(o) => { if (!o) { setShowCleanConfirm(false); setPendingFile(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing products?</AlertDialogTitle>
            <AlertDialogDescription>
              ⚠️ This will DELETE all {activeProductCount} existing products for {supplierName} before importing new ones. This ensures a clean catalog with no stale data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowCleanConfirm(false);
              if (pendingFile) {
                runAnalysis(pendingFile);
                setPendingFile(null);
              } else if (pendingReparse) {
                setPendingReparse(false);
                handleReparse();
              }
            }}>
              Continue — Clean & Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Preview Modal */}
      {importPreview && (
        <ImportPreviewModal
          open={!!importPreview}
          onOpenChange={(o) => !o && setImportPreview(null)}
          preview={importPreview}
          fileName={importFileName}
          onConfirm={handleConfirm}
          confirming={importConfirming}
        />
      )}
      {supplierInfoExtracted && (
        <SupplierInfoReviewModal
          open={!!supplierInfoExtracted}
          onOpenChange={(o) => !o && setSupplierInfoExtracted(null)}
          supplierId={supplierId}
          supplierName={supplierName}
          extracted={supplierInfoExtracted}
          onComplete={() => {
            setSupplierInfoExtracted(null);
            queryClient.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
            queryClient.invalidateQueries({ queryKey: ["supplier-locations", supplierId] });
          }}
        />
      )}
    </>
  );
};

export default SupplierImportPanel;

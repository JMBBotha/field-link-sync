import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ImportPreviewModal from "./ImportPreviewModal";
import type { ImportPreview, ParsedProduct, ImportStage } from "@/services/productImportParser";
import { cleanImportForSupplier, logImportAction } from "@/services/cleanImportPipeline";
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
    pendingFileRef.current = file;
    try {
      const { parseImportFile } = await import("@/services/productImportParser");
      const preview = await parseImportFile(file, supplierId);
      setImportPreview(preview);
    } catch (err: any) {
      console.error("[Import] Analysis failed:", err);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setImportAnalysing(false);
    }
  }, [supplierId, toast]);

  const handleConfirm = useCallback(async (products: ParsedProduct[]) => {
    setImportConfirming(true);
    try {
      // Step 1: Clean import — purge old data
      console.log("[Import] Step 1: Clean purge...");
      const purgeResult = await cleanImportForSupplier(supplierId);
      await logImportAction({
        supplierId,
        action: "clean_purge",
        productsDeleted: purgeResult.deletedProducts,
        pdfsDeleted: purgeResult.deletedPdfs,
      });

      // Step 2: Upload PDF to storage (if it's a PDF file)
      let pdfUploadId: string | null = null;
      const file = pendingFileRef.current;
      if (file && file.name.toLowerCase().endsWith(".pdf")) {
        console.log("[Import] Step 2: Uploading PDF to storage...");
        const filePath = `${supplierId}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("supplier-pdfs")
          .upload(filePath, file);
        if (uploadError) {
          console.warn("[Import] Storage upload failed (non-fatal):", uploadError.message);
        }

        // Step 3: Create pdf_uploads record
        const { data: pdfRecord, error: pdfError } = await (supabase.from("pdf_uploads") as any)
          .insert({
            supplier_id: supplierId,
            file_name: file.name,
            file_path: filePath,
            status: "parsed",
          })
          .select()
          .single();
        if (pdfError) {
          console.warn("[Import] PDF record creation failed (non-fatal):", pdfError.message);
        } else {
          pdfUploadId = pdfRecord?.id || null;
        }
      }

      // Step 4: Insert products in batches
      console.log(`[Import] Step 4: Inserting ${products.length} products...`);
      const rows = products.map((p) => ({
        supplier_id: supplierId,
        product_code: p.model_number || "UNKNOWN",
        short_name: (p.description || "").substring(0, 80),
        description: p.description || "",
        category: p.category || "Uncategorized",
        product_category: p.category || "Uncategorized",
        cost_excl_vat: p.price_excl_vat,
        cost_price: p.cost_price,
        rrp: p.raw_price,
        cost_incl_vat: p.price_includes_vat ? p.raw_price : parseFloat((p.price_excl_vat * 1.15).toFixed(2)),
        default_markup_percent: p.markup_percent,
        selling_price: p.calculated_price,
        sell_price_incl_vat: p.sell_price_incl_vat,
        vat_amount: p.vat_amount,
        list_price_raw: p.raw_price,
        price_includes_vat: p.price_includes_vat,
        price_excl_vat: p.price_excl_vat,
        supplier_discount_percent: p.supplier_discount_percent,
        markup_percent: p.markup_percent,
        import_confidence: p.confidence,
        brand: supplierName || "",
        is_active: true,
        archived: false,
        ...(pdfUploadId ? { pdf_upload_id: pdfUploadId } : {}),
      }));

      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await (supabase.from("supplier_products") as any).insert(batch);
        if (error) {
          console.error(`[Import] Batch ${i / 50 + 1} failed:`, error);
          throw new Error(`Product insert failed at batch ${i / 50 + 1}: ${error.message}`);
        }
      }

      // Step 5: Log audit
      const isPdf = importFileName.toLowerCase().endsWith(".pdf");
      await logImportAction({
        supplierId,
        action: isPdf ? "pdf_import" : "csv_import",
        productsImported: products.length,
        fileName: importFileName,
      });

      console.log(`[Import] ✅ Complete — ${products.length} products imported`);
      invalidateAll();
      onImportComplete?.();
      toast({
        title: `✅ ${products.length} products imported`,
        description: `${supplierName} catalog updated.`,
      });
      setImportPreview(null);
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
                  <div className="flex items-center justify-center gap-2 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analysing {importFileName}...
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
    </>
  );
};

export default SupplierImportPanel;

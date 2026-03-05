import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ImportPreviewModal from "./ImportPreviewModal";
import type { ImportPreview, ParsedProduct } from "@/services/productImportParser";
import { cleanImportForSupplier, logImportAction } from "@/services/cleanImportPipeline";

interface SupplierImportPanelProps {
  supplierId: string;
  supplierName: string;
  onImportComplete?: () => void;
  compact?: boolean;
}

const SupplierImportPanel = ({ supplierId, supplierName, onImportComplete, compact = false }: SupplierImportPanelProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);

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
      const { count, error } = await (supabase.from("pdf_uploads") as any)
        .select("*", { count: "exact", head: true })
        .eq("supplier_id", supplierId);
      if (error) return 0;
      return count || 0;
    },
  });

  const { data: lastImport } = useQuery({
    queryKey: ["supplier-last-import", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("import_audit_log") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .in("action", ["pdf_import", "csv_import"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error || !data?.length) return null;
      return data[0];
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

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".pdf") && !ext.endsWith(".csv")) {
      toast({ title: "Only PDF or CSV files supported", variant: "destructive" });
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
  }, [activeProductCount, toast]);

  const runAnalysis = useCallback(async (file: File) => {
    setImportAnalysing(true);
    setImportFileName(file.name);
    try {
      const { parseImportFile } = await import("@/services/productImportParser");
      const preview = await parseImportFile(file, supplierId);
      setImportPreview(preview);
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setImportAnalysing(false);
    }
  }, [supplierId, toast]);

  const handleConfirm = useCallback(async (products: ParsedProduct[]) => {
    setImportConfirming(true);
    try {
      const purgeResult = await cleanImportForSupplier(supplierId);
      await logImportAction({
        supplierId,
        action: "clean_purge",
        productsDeleted: purgeResult.deletedProducts,
        pdfsDeleted: purgeResult.deletedPdfs,
      });

      const rows = products.map((p) => ({
        supplier_id: supplierId,
        product_code: p.model_number,
        short_name: p.description.substring(0, 80),
        description: p.description,
        product_category: p.category,
        cost_excl_vat: p.price_excl_vat,
        cost_price: p.cost_price,
        rrp: p.raw_price,
        cost_incl_vat: p.price_includes_vat ? p.raw_price : parseFloat((p.price_excl_vat * 1.15).toFixed(2)),
        default_markup_percent: p.markup_percent,
        selling_price: p.calculated_price,
        brand: supplierName || "",
        is_active: true,
        archived: false,
      }));

      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await (supabase.from("supplier_products") as any).insert(batch);
        if (error) throw error;
      }

      const isPdf = importFileName.toLowerCase().endsWith(".pdf");
      await logImportAction({
        supplierId,
        action: isPdf ? "pdf_import" : "csv_import",
        productsImported: products.length,
        fileName: importFileName,
      });

      invalidateAll();
      onImportComplete?.();
      toast({
        title: `✅ ${products.length} products imported`,
        description: `${supplierName} catalog updated.`,
      });
      setImportPreview(null);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportConfirming(false);
    }
  }, [supplierId, supplierName, importFileName, invalidateAll, onImportComplete, toast]);

  return (
    <>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {/* Drop zone / upload area */}
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
                  if (file) {
                    const ext = file.name.toLowerCase();
                    if (ext.endsWith(".pdf") || ext.endsWith(".csv")) {
                      if (activeProductCount > 0) {
                        setPendingFile(file);
                        setShowCleanConfirm(true);
                      } else {
                        runAnalysis(file);
                      }
                    } else {
                      toast({ title: "Only PDF or CSV files supported", variant: "destructive" });
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

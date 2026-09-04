import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Trash2, Loader2, ImagePlus, PackageX, FileSpreadsheet, Sparkles } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PDFExtractReviewModal from "./PDFExtractReviewModal";
import SupplierInfoReviewModal from "./SupplierInfoReviewModal";
import ImportPreviewModal from "./ImportPreviewModal";
import type { ExtractedSupplierInfo } from "@/services/supplierInfoExtractor";
import type { ImportPreview, ParsedProduct } from "@/services/productImportParser";
import { cleanImportForSupplier, logImportAction } from "@/services/cleanImportPipeline";
import { buildProductDiff, applyProductDiff, type DiffImportRow } from "@/services/diffImportPipeline";

interface SupplierDocument {
  id: string;
  supplier_id: string;
  file_name: string;
  storage_path: string;
  file_type: string | null;
  created_at: string;
}

interface SupplierDocumentsTabProps {
  supplierId: string;
  supplierName?: string;
}

const SupplierDocumentsTab = ({ supplierId, supplierName }: SupplierDocumentsTabProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const priceListInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processingPriceList, setProcessingPriceList] = useState(false);
  const [priceListProgress, setPriceListProgress] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<Record<string, string> | null>(null);
  const [showDeleteCatalog, setShowDeleteCatalog] = useState(false);
  const [deletingCatalog, setDeletingCatalog] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [pendingReplaceFile, setPendingReplaceFile] = useState<File | null>(null);
  const [showDeleteProducts, setShowDeleteProducts] = useState(false);
  const [deletingProducts, setDeletingProducts] = useState(false);
  const [productDeleteMode, setProductDeleteMode] = useState<"archive" | "delete">("archive");
  const [supplierInfoExtracted, setSupplierInfoExtracted] = useState<ExtractedSupplierInfo | null>(null);

  // AI Import state
  const [importAnalysing, setImportAnalysing] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importConfirming, setImportConfirming] = useState(false);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["supplier-documents", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_documents") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SupplierDocument[];
    },
  });

  // Check if this supplier already has Visual Catalog pages
  const { data: catalogInfo = { count: 0, uploadedAt: null, pdfFilename: null } } = useQuery({
    queryKey: ["supplier-catalog-pages", supplierId],
    queryFn: async () => {
      const { data, count, error } = await (supabase.from("supplier_pdf_pages") as any)
        .select("uploaded_at, pdf_filename", { count: "exact" })
        .eq("supplier_id", supplierId)
        .order("page_number", { ascending: true })
        .limit(1);
      if (error) return { count: 0, uploadedAt: null, pdfFilename: null };
      return {
        count: count || 0,
        uploadedAt: data?.[0]?.uploaded_at || null,
        pdfFilename: data?.[0]?.pdf_filename || null,
      };
    },
  });
  const catalogPageCount = catalogInfo.count;

  // Count active products for this supplier
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

  // Import audit log
  const { data: importHistory = [] } = useQuery({
    queryKey: ["import-audit-log", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("import_audit_log") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return data || [];
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-active-product-count", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["supplier-product-count", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers-list"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
    queryClient.invalidateQueries({ queryKey: ["consumable-products"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-catalog-pages", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["import-audit-log", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
    queryClient.invalidateQueries({ queryKey: ["product-category-counts"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
    queryClient.invalidateQueries({ queryKey: ["visual-panel-suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
    queryClient.invalidateQueries({ queryKey: ["visual-catalog-suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["visual-catalog-pages"] });
  };

  const deleteAllProducts = async (mode: "archive" | "delete") => {
    setDeletingProducts(true);
    try {
      if (mode === "delete") {
        await cleanImportForSupplier(supplierId);
        await logImportAction({ supplierId, action: "clean_purge", productsDeleted: activeProductCount });
      } else {
        const { error } = await (supabase.from("supplier_products") as any)
          .update({ archived: true })
          .eq("supplier_id", supplierId)
          .or("archived.is.null,archived.eq.false");
        if (error) throw error;
      }
      invalidateAll();
      toast({ title: mode === "delete" ? "All products permanently deleted" : "All products archived" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingProducts(false);
      setShowDeleteProducts(false);
    }
  };

  const deleteCatalogPages = async () => {
    setDeletingCatalog(true);
    try {
      const { data: pages } = await (supabase.from("supplier_pdf_pages") as any)
        .select("page_image_url, pdf_filename, pdf_storage_path")
        .eq("supplier_id", supplierId);

      if (pages && pages.length > 0) {
        const imagePaths = pages
          .map((p: any) => {
            const url = p.page_image_url || "";
            const match = url.match(/supplier-pdf-pages\/(.+)$/);
            return match ? match[1] : null;
          })
          .filter(Boolean);

        if (imagePaths.length > 0) {
          await supabase.storage.from("supplier-pdf-pages").remove(imagePaths);
        }

        const filename = pages[0]?.pdf_filename;
        if (filename) {
          await supabase.storage.from("supplier-pdfs").remove([`${supplierId}/${filename}`]);
        }
      }

      await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", supplierId);
      invalidateAll();
      toast({ title: "PDF catalog deleted", description: `${pages?.length || 0} pages removed.` });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingCatalog(false);
      setShowDeleteCatalog(false);
    }
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    const maxPages = Math.min(pdf.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(" ") + "\n";
    }
    return text;
  };

  const parseExtractedInfo = (text: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const phoneMatch = text.match(/(?:\+27|0)\s*\d{2}\s*\d{3}\s*\d{4}/g);
    if (phoneMatch) result.phone = phoneMatch[0].replace(/\s/g, "");
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatch) result.email = emailMatch[0];
    const vatMatch = text.match(/(?:VAT|vat)\s*(?:No\.?|Number|#)?\s*:?\s*(\d{10})/i);
    if (vatMatch) result.vat_number = vatMatch[1];
    const regMatch = text.match(/(?:Reg|Registration|CK)\s*(?:No\.?|Number|#)?\s*:?\s*([\d/]+)/i);
    if (regMatch) result.registration_number = regMatch[1];
    const webMatch = text.match(/(?:www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi);
    if (webMatch) result.website = webMatch[0];
    return result;
  };

  /** Handle replace confirmation */
  const handlePriceListInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Only PDF files supported", variant: "destructive" });
      if (priceListInputRef.current) priceListInputRef.current.value = "";
      return;
    }
    if (catalogPageCount > 0) {
      setPendingReplaceFile(file);
      setShowReplaceConfirm(true);
    } else {
      processUpload(file);
    }
  }, [catalogPageCount, toast]);

  /** Process a PDF into page images for the Visual Catalog.
   * Only replaces this supplier's OLD PAGE IMAGES — this flow is purely for
   * the visual-catalog viewer and must never touch supplier_products. It used
   * to call cleanImportForSupplier() (full hard-delete of the product catalog)
   * even though it doesn't import any products; see
   * docs/pricing-and-import-architecture-findings.md. */
  const processUpload = useCallback(async (file: File) => {
    setProcessingPriceList(true);
    setPriceListProgress("Removing old pages...");

    try {
      // ── Replace only the old PDF page images (not products) ──
      const { data: oldPages } = await (supabase.from("supplier_pdf_pages" as any) as any)
        .select("page_image_url")
        .eq("supplier_id", supplierId);
      if (oldPages && oldPages.length > 0) {
        const imagePaths = oldPages
          .map((p: any) => {
            const url = p.page_image_url || "";
            const match = url.match(/supplier-pdf-pages\/(.+)$/);
            return match ? match[1] : null;
          })
          .filter(Boolean) as string[];
        if (imagePaths.length > 0) {
          await supabase.storage.from("supplier-pdf-pages").remove(imagePaths);
        }
      }
      await (supabase.from("supplier_pdf_pages" as any) as any).delete().eq("supplier_id", supplierId);

      // ── Process the new PDF ──
      setPriceListProgress("Loading PDF...");
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      setPriceListProgress(`Processing ${totalPages} pages...`);

      const SCALE = 1.5;
      const batchRows: any[] = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        setPriceListProgress(`Rendering page ${pageNum} of ${totalPages}...`);

        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: SCALE });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob: Blob = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85)
        );

        const storagePath = `${supplierId}/${file.name}/page_${pageNum}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from("supplier-pdf-pages")
          .upload(storagePath, blob, { upsert: true, contentType: "image/jpeg" });

        if (uploadErr) {
          console.error(`[PriceList] Failed to upload page ${pageNum}:`, uploadErr);
          continue;
        }

        const { data: urlData } = supabase.storage.from("supplier-pdf-pages").getPublicUrl(storagePath);

        batchRows.push({
          supplier_id: supplierId,
          pdf_filename: file.name,
          page_number: pageNum,
          page_image_url: urlData.publicUrl,
        });

        if (batchRows.length >= 10) {
          await (supabase.from("supplier_pdf_pages") as any).insert(batchRows.splice(0, 10));
        }

        canvas.width = 0;
        canvas.height = 0;
      }

      if (batchRows.length > 0) {
        await (supabase.from("supplier_pdf_pages") as any).insert(batchRows);
      }

      // Upload the source PDF
      const pdfStoragePath = `${supplierId}/${file.name}`;
      await supabase.storage.from("supplier-pdfs").upload(pdfStoragePath, file, { upsert: true, contentType: "application/pdf" });
      const { data: pdfUrlData } = supabase.storage.from("supplier-pdfs").getPublicUrl(pdfStoragePath);
      if (pdfUrlData?.publicUrl) {
        await (supabase.from("supplier_pdf_pages") as any)
          .update({ pdf_storage_path: pdfUrlData.publicUrl })
          .eq("supplier_id", supplierId)
          .eq("pdf_filename", file.name);
      }

      invalidateAll();
      toast({ title: `Price list uploaded`, description: `${totalPages} pages processed for Visual Catalog.` });

      // Auto-extract supplier contact info
      try {
        const { extractSupplierInfoFromPDF } = await import("@/services/supplierInfoExtractor");
        const info = await extractSupplierInfoFromPDF(file);
        const hasInfo = info.allEmails.length > 0 || info.allPhones.length > 0 ||
          info.vatNumber || info.website || info.departments.length > 0 || info.locations.length > 0;
        if (hasInfo) setSupplierInfoExtracted(info);
      } catch (extractErr) {
        console.warn("[PriceList] Contact extraction failed:", extractErr);
      }
    } catch (err: any) {
      console.error("[PriceList] Processing failed:", err);
      toast({ title: "Price list processing failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessingPriceList(false);
      setPriceListProgress("");
      if (priceListInputRef.current) priceListInputRef.current.value = "";
    }
  }, [supplierId, queryClient, toast]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const path = `${supplierId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("supplier-documents")
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { error: dbError } = await (supabase.from("supplier_documents") as any).insert({
        supplier_id: supplierId,
        file_name: file.name,
        storage_path: path,
        file_type: file.type,
      });
      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: ["supplier-documents", supplierId] });
      toast({ title: "Document uploaded" });

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        try {
          const text = await extractTextFromPDF(file);
          const info = parseExtractedInfo(text);
          if (Object.keys(info).length > 0) {
            setExtractedData(info);
          }
        } catch (parseErr) {
          console.warn("PDF parse failed:", parseErr);
        }
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (doc: SupplierDocument) => {
      await supabase.storage.from("supplier-documents").remove([doc.storage_path]);
      const { error } = await (supabase.from("supplier_documents") as any).delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-documents", supplierId] });
      toast({ title: "Document deleted" });
      setDeleteId(null);
    },
  });

  const deleteDoc = documents.find((d) => d.id === deleteId);

  // ── AI Import Handler — safe diff-based import (archives missing products,
  // never hard-deletes) — see docs/pricing-and-import-architecture-findings.md ──
  const handleImportFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    if (!isPdf && !isCsv) {
      toast({ title: "Only PDF or CSV files supported", variant: "destructive" });
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }

    // Diff-based import safely merges with any existing catalog (new/updated
    // rows are upserted, missing rows are archived) — no destructive purge
    // confirmation needed regardless of how many products already exist.
    runImportAnalysis(file);
    if (importInputRef.current) importInputRef.current.value = "";
  }, [toast]);

  const runImportAnalysis = useCallback(async (file: File) => {
    setImportAnalysing(true);
    setImportFileName(file.name);
    importFileRef.current = file;
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

  const handleImportConfirm = useCallback(async (products: ParsedProduct[], isFullCatalogue: boolean = true) => {
    setImportConfirming(true);
    try {
      const file = importFileRef.current;

      // Safe diff-based import: matches by product_code, upserts new/changed
      // rows, and archives (never hard-deletes) rows missing from this file.
      const rows: DiffImportRow[] = products.map((p) => ({
        product_code: p.model_number,
        description: p.description || "",
        category: p.category || "General",
        cost_price: p.cost_price,
        pipe_size: p.pipe_size || null,
        btu_rating: p.btu_rating ?? null,
        refrigerant_type: p.refrigerant_type || null,
        is_price_on_request: (p.raw_price ?? p.cost_price) <= 0,
        short_name: p.short_name || null,
        brand: p.brand || null,
        product_category: p.product_category || p.category || undefined,
        sold_in_length: p.sold_in_length || false,
        unit_length: p.unit_length ?? null,
        price_per_metre: p.price_per_metre ?? null,
      })).filter((r) => r.product_code && r.product_code.trim().length >= 2);

      const diffRows = await buildProductDiff(supplierId, rows);
      const { imported, updated, archived, unchanged, errors, firstError } = await applyProductDiff({
        supplierId,
        supplierName: supplierName || "",
        diffRows,
        defaultMarkupPercent: products[0]?.default_markup_percent || 30,
        fileName: file?.name || "AI Import",
        isFullCatalogue,
      });

      if (imported === 0 && updated === 0 && archived === 0 && errors > 0) {
        throw new Error(firstError || "Import pipeline failed");
      }

      invalidateAll();
      toast({
        title: `✅ ${imported} inserted · ${updated} updated · ${archived} archived · ${unchanged} unchanged`,
        description: `${supplierName || "Supplier"} catalog updated. Archiving is limited to the brands in this file.${errors > 0 ? ` ${errors} failed — ${firstError.substring(0, 100)}` : ""}`,
        variant: errors > 0 ? "destructive" : undefined,
      });
      setImportPreview(null);

      // ── Auto-extract supplier contact info from PDF ──
      if (file && file.name.toLowerCase().endsWith(".pdf")) {
        try {
          const { extractSupplierInfoFromPDF } = await import("@/services/supplierInfoExtractor");
          const info = await extractSupplierInfoFromPDF(file);
          const hasInfo = info.allEmails.length > 0 || info.allPhones.length > 0 ||
            info.vatNumber || info.website || info.departments.length > 0 || info.locations.length > 0;
          if (hasInfo) {
            console.log("[Import] Supplier info extracted, showing review modal");
            setSupplierInfoExtracted(info);
          }
        } catch (extractErr) {
          console.warn("[Import] Supplier info extraction failed (non-fatal):", extractErr);
        }
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportConfirming(false);
    }
  }, [supplierId, supplierName, importFileName, queryClient, toast]);

  const handleClearAndReupload = async () => {
    setDeletingProducts(true);
    try {
      const purgeResult = await cleanImportForSupplier(supplierId);
      await logImportAction({
        supplierId,
        action: "clean_purge",
        productsDeleted: purgeResult.deletedProducts,
        pdfsDeleted: purgeResult.deletedPdfs,
      });
      invalidateAll();
      toast({ title: "All products & PDFs cleared", description: "Upload a new price list below." });
      setTimeout(() => priceListInputRef.current?.click(), 300);
    } catch (err: any) {
      toast({ title: "Clear failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingProducts(false);
    }
  };

  return (
    <div className="space-y-3 mt-2">
      {/* Manage PDFs link */}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => navigate(`/admin/pdf-documents?supplier=${supplierId}`)}
      >
        <FileText className="h-4 w-4 mr-2" />
        Manage PDFs →
      </Button>

      {/* Clear All & Re-upload */}
      {(activeProductCount > 0 || catalogPageCount > 0) && (
        <Card className="border-dashed border-destructive/30 bg-destructive/5">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Trash2 className="h-4 w-4 text-destructive shrink-0" />
                Clear All & Re-upload
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Purges all {activeProductCount} products, {catalogPageCount} PDF pages, and cached data. Clean slate.
              </p>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleClearAndReupload}
              disabled={deletingProducts}
              className="text-xs shrink-0"
            >
              {deletingProducts ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
              Clear & Re-upload
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Price List Upload for Visual Catalog */}
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <ImagePlus className="h-4 w-4 text-primary shrink-0" />
                Visual Catalog PDF
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Upload a price list PDF to browse in the Visual Catalog viewer.
              </p>
              {catalogPageCount > 0 && (
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">
                    {catalogPageCount} pages uploaded
                  </Badge>
                  {catalogInfo.uploadedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(catalogInfo.uploadedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {catalogPageCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDeleteCatalog(true)}
                  disabled={deletingCatalog || processingPriceList}
                  className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
                >
                  {deletingCatalog ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              )}
              <input
                ref={priceListInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handlePriceListInputChange}
              />
              <Button
                size="sm"
                variant={catalogPageCount > 0 ? "outline" : "default"}
                onClick={() => priceListInputRef.current?.click()}
                disabled={processingPriceList || deletingCatalog}
                className="text-xs"
              >
                {processingPriceList ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />{priceListProgress || "Processing..."}</>
                ) : catalogPageCount > 0 ? (
                  <><ImagePlus className="h-3 w-3 mr-1" />Replace PDF</>
                ) : (
                  <><ImagePlus className="h-3 w-3 mr-1" />Upload Price List</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Product Import (PDF/CSV) — NO stored PDF extraction */}
      <Card className="border-dashed border-accent/30 bg-accent/5">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-accent-foreground shrink-0" />
                AI Product Import
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Upload a PDF or CSV — AI detects VAT, discounts & pricing. Safely merges with your existing catalog.
              </p>
            </div>
            <div className="shrink-0">
              <input
                ref={importInputRef}
                type="file"
                accept=".pdf,.csv"
                className="hidden"
                onChange={handleImportFileSelect}
              />
              <Button
                size="sm"
                variant="default"
                onClick={() => importInputRef.current?.click()}
                disabled={importAnalysing}
                className="text-xs gap-1.5"
              >
                {importAnalysing ? (
                  <><Loader2 className="h-3 w-3 animate-spin" />Analysing...</>
                ) : (
                  <><FileSpreadsheet className="h-3 w-3" />Import Products</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {activeProductCount > 0 && catalogPageCount === 0 && (
        <Card className="border-dashed border-destructive/30 bg-destructive/5">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-1.5 text-destructive">
                  <PackageX className="h-4 w-4 shrink-0" />
                  {activeProductCount} orphaned products
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Products exist without a PDF catalog.
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setProductDeleteMode("archive"); setShowDeleteProducts(true); }}
                  disabled={deletingProducts}
                  className="text-xs"
                >
                  Archive All
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { setProductDeleteMode("delete"); setShowDeleteProducts(true); }}
                  disabled={deletingProducts}
                  className="text-xs"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Delete All
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      {importHistory.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-sm font-semibold mb-2">📋 Import History</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {importHistory.map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between text-[11px] py-1 border-b last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {new Date(entry.created_at).toLocaleDateString()}{" "}
                      {new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <Badge variant={entry.action === "clean_purge" ? "destructive" : "default"} className="text-[9px] px-1.5 py-0">
                      {entry.action === "clean_purge" ? "Purge" : entry.action === "pdf_import" ? "PDF Import" : "CSV Import"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {entry.file_name && <span className="truncate max-w-[120px]">{entry.file_name}</span>}
                    {entry.products_deleted > 0 && <span className="text-destructive">-{entry.products_deleted}</span>}
                    {entry.products_imported > 0 && <span className="text-green-600">+{entry.products_imported}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Regular documents */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{documents.length} document{documents.length !== 1 ? "s" : ""}</p>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            className="hidden"
            onChange={handleUpload}
          />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
            Upload Document
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id} className="group">
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setDeleteId(doc.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {extractedData && (
        <PDFExtractReviewModal
          open={!!extractedData}
          onOpenChange={(o) => !o && setExtractedData(null)}
          extractedData={extractedData}
          supplierId={supplierId}
        />
      )}

      {supplierInfoExtracted && (
        <SupplierInfoReviewModal
          open={!!supplierInfoExtracted}
          onOpenChange={(o) => !o && setSupplierInfoExtracted(null)}
          supplierId={supplierId}
          supplierName={supplierName || "Supplier"}
          extracted={supplierInfoExtracted}
          onComplete={() => {
            queryClient.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
            queryClient.invalidateQueries({ queryKey: ["supplier-detail", supplierId] });
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteDoc?.file_name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDoc && deleteMutation.mutate(deleteDoc)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete catalog confirmation */}
      <AlertDialog open={showDeleteCatalog} onOpenChange={setShowDeleteCatalog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PDF Catalog?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete all {catalogPageCount} PDF catalog pages? The supplier will be removed from the Visual Catalog until a new PDF is uploaded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCatalog}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteCatalogPages}
              disabled={deletingCatalog}
            >
              {deletingCatalog ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Deleting...</> : "Delete All Pages"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace catalog confirmation */}
      <AlertDialog open={showReplaceConfirm} onOpenChange={(o) => { if (!o) { setShowReplaceConfirm(false); setPendingReplaceFile(null); if (priceListInputRef.current) priceListInputRef.current.value = ""; } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace PDF Catalog?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the {catalogPageCount} existing page images and replace them with the new PDF. Your product catalog (prices, stock, etc.) is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowReplaceConfirm(false); if (pendingReplaceFile) { processUpload(pendingReplaceFile); setPendingReplaceFile(null); } }}>
              Replace Pages
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete all products confirmation */}
      <AlertDialog open={showDeleteProducts} onOpenChange={setShowDeleteProducts}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {productDeleteMode === "delete" ? "Permanently delete all products?" : "Archive all products?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {productDeleteMode === "delete"
                ? `This will permanently delete all ${activeProductCount} products for this supplier.`
                : `This will archive all ${activeProductCount} products for this supplier.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProducts}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAllProducts(productDeleteMode)}
              disabled={deletingProducts}
            >
              {deletingProducts
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />{productDeleteMode === "delete" ? "Deleting..." : "Archiving..."}</>
                : productDeleteMode === "delete"
                  ? `Delete ${activeProductCount} Products`
                  : `Archive ${activeProductCount} Products`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI Import Preview Modal */}
      {importPreview && (
        <ImportPreviewModal
          open={!!importPreview}
          onOpenChange={(o) => !o && setImportPreview(null)}
          preview={importPreview}
          fileName={importFileName}
          onConfirm={handleImportConfirm}
          confirming={importConfirming}
        />
      )}
    </div>
  );
};

export default SupplierDocumentsTab;

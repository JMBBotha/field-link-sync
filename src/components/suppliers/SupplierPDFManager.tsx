import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, Trash2, Eye, Search, Loader2, AlertTriangle, Database, HardDrive, Package, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface PDFUploadRow {
  id: string;
  file_name: string | null;
  file_path: string | null;
  storage_path: string | null;
  file_url: string | null;
  created_at: string;
  status: string | null;
  supplier_id: string;
  suppliers: { id: string; name: string } | null;
  /** Current active book for this supplier+brand. Synthetic page-group rows are always active. */
  is_active?: boolean | null;
  brand?: string | null;
  /** False for synthetic rows built from supplier_pdf_pages (no pdf_uploads row to flag). */
  can_activate?: boolean;
}

interface SupplierPDFManagerProps {
  preFilterSupplierId?: string;
}

const STORAGE_BUCKETS = ["supplier-pdf-pages", "stock-documents", "product-image", "pdfs", "price-lists"];
const PREVIEW_BUCKETS = ["supplier-pdf-pages", "supplier-pdfs", "stock-documents", "price-lists", "pdfs"] as const;

type PreviewCandidate = {
  bucket?: string;
  path?: string;
  directUrl?: string;
  label: string;
};

const STORAGE_URL_PATTERN = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/;

const decodeStoragePath = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const extractStorageCandidateFromUrl = (value: string): PreviewCandidate | null => {
  try {
    const parsed = new URL(value);
    const match = `${parsed.pathname}${parsed.search}`.match(STORAGE_URL_PATTERN);
    if (!match) {
      return {
        directUrl: value,
        label: value,
      };
    }

    return {
      bucket: match[1],
      path: decodeStoragePath(match[2].split("?")[0]),
      directUrl: value,
      label: `${match[1]}/${decodeStoragePath(match[2].split("?")[0])}`,
    };
  } catch {
    return {
      directUrl: value,
      label: value,
    };
  }
};

const buildPreviewCandidates = (pdf: PDFUploadRow): PreviewCandidate[] => {
  const rawValues = [pdf.file_path, pdf.storage_path, pdf.file_url].filter(Boolean) as string[];
  const candidates: PreviewCandidate[] = [];

  for (const value of rawValues) {
    if (/^https?:\/\//i.test(value)) {
      const extracted = extractStorageCandidateFromUrl(value);
      if (extracted) candidates.push(extracted);
      continue;
    }

    const cleanValue = value.replace(/^\/+/, "");
    for (const bucket of PREVIEW_BUCKETS) {
      candidates.push({
        bucket,
        path: cleanValue,
        label: `${bucket}/${cleanValue}`,
      });
    }
  }

  if (pdf.supplier_id && pdf.file_name) {
    const supplierPath = `${pdf.supplier_id}/${pdf.file_name}`;
    for (const bucket of PREVIEW_BUCKETS) {
      candidates.push({
        bucket,
        path: supplierPath,
        label: `${bucket}/${supplierPath}`,
      });
    }
  }

  if (pdf.file_name) {
    for (const bucket of PREVIEW_BUCKETS) {
      candidates.push({
        bucket,
        path: pdf.file_name,
        label: `${bucket}/${pdf.file_name}`,
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.bucket || "url"}::${candidate.path || candidate.directUrl}`;
    if (!candidate.path && !candidate.directUrl) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchPdfBlob = async (sourceUrl: string, fileName?: string) => {
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF (${response.status})`);
  }

  const rawBlob = await response.blob();
  if (!rawBlob.size) {
    throw new Error("Downloaded PDF is empty");
  }

  // Force correct MIME type — raw blob may have wrong/missing content-type
  const pdfBlob = new Blob([rawBlob], { type: "application/pdf" });
  return pdfBlob;
};

async function deleteSinglePDF(pdf: PDFUploadRow) {
  const isSynthetic = pdf.id.startsWith("spp-");
  let productIds: string[] = [];

  if (isSynthetic) {
    // Synthetic entry from supplier_pdf_pages — find products by supplier_id
    const supplierId = pdf.supplier_id;
    if (supplierId) {
      const { data: products } = await (supabase.from("supplier_products") as any)
        .select("id")
        .eq("supplier_id", supplierId);
      productIds = (products || []).map((p: any) => p.id);
    }
  } else {
    // Legacy pdf_uploads entry — find products by pdf_upload_id first, fall back to supplier_id
    const { data: products } = await (supabase.from("supplier_products") as any)
      .select("id")
      .eq("pdf_upload_id", pdf.id);
    productIds = (products || []).map((p: any) => p.id);
    // If no products found by pdf_upload_id, also clean ALL products for this supplier
    if (productIds.length === 0 && pdf.supplier_id) {
      const { data: allProducts } = await (supabase.from("supplier_products") as any)
        .select("id")
        .eq("supplier_id", pdf.supplier_id);
      productIds = (allProducts || []).map((p: any) => p.id);
    }
  }

  // 2. Delete dependent records then products
  if (productIds.length > 0) {
    for (let i = 0; i < productIds.length; i += 500) {
      const batch = productIds.slice(i, i + 500);
      await (supabase.from("quote_items") as any).delete().in("product_id", batch);
      await (supabase.from("job_used_parts") as any).delete().in("product_id", batch);
      await (supabase.from("inventory_stock") as any).delete().in("product_id", batch);
      await (supabase.from("bundle_items") as any).delete().in("supplier_product_id", batch);
      await (supabase.from("pdf_product_regions") as any).delete().in("product_id", batch);
      await (supabase.from("supplier_products") as any).delete().in("id", batch);
    }
  }

  // 3. Delete PDF region overlays (legacy)
  if (!isSynthetic) {
    await (supabase.from("pdf_product_regions") as any).delete().eq("pdf_upload_id", pdf.id);
  }

  // 4. Delete supplier_pdf_pages — use pdf_filename only (supplier_id may be text name, not UUID)
  if (pdf.file_name) {
    console.log("[PDF Delete] Deleting supplier_pdf_pages by pdf_filename:", pdf.file_name);
    const { error: pagesErr, count: pagesCount } = await (supabase.from("supplier_pdf_pages") as any)
      .delete()
      .eq("pdf_filename", pdf.file_name)
      .select("id", { count: "exact", head: true });
    console.log("[PDF Delete] supplier_pdf_pages delete result:", { error: pagesErr, count: pagesCount });
  }

  // 5. Delete the pdf_uploads DB record (legacy only)
  if (!isSynthetic) {
    await (supabase.from("pdf_uploads") as any).delete().eq("id", pdf.id);
  }

  // 6. Delete actual file from storage
  const rawPath = pdf.file_path || pdf.storage_path || pdf.file_url || null;
  if (rawPath) {
    const match = rawPath.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
    const cleanPath = match ? match[1] : rawPath;
    for (const bucket of STORAGE_BUCKETS) {
      try { await supabase.storage.from(bucket).remove([cleanPath]); } catch {}
    }
  }

  // Also try supplier-specific folder cleanup
  const supplierId = pdf.supplier_id;
  if (supplierId && pdf.file_name) {
    for (const bucket of STORAGE_BUCKETS) {
      try { await supabase.storage.from(bucket).remove([`${supplierId}/${pdf.file_name}`]); } catch {}
    }
  }

  return { success: true, productsDeleted: productIds.length };
}
const PdfPreviewEmbed = ({ url, fileName }: { url: string; fileName?: string | null }) => {
  return (
    <iframe
      src={url}
      className="w-full h-full border border-border rounded-lg shadow-inner"
      style={{ minHeight: "500px" }}
      title={fileName || "PDF Preview"}
    />
  );
};

const SupplierPDFManager = ({ preFilterSupplierId }: SupplierPDFManagerProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [supplierFilter, setSupplierFilter] = useState(preFilterSupplierId || "all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<PDFUploadRow | null>(null);
  const [deleteProductCount, setDeleteProductCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDebugMessage, setPreviewDebugMessage] = useState<string | null>(null);
  const [purgingOrphans, setPurgingOrphans] = useState(false);

  const clearPreviewUrl = useCallback((url?: string | null) => {
    if (url?.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const resetPreviewState = useCallback(() => {
    setPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewDebugMessage(null);
    setPreviewFileName(null);
    setPreviewUrl((current) => {
      clearPreviewUrl(current);
      return null;
    });
  }, [clearPreviewUrl]);

  useEffect(() => {
    return () => {
      clearPreviewUrl(previewUrl);
    };
  }, [previewUrl, clearPreviewUrl]);

  // Fetch all PDFs — merge pdf_uploads AND supplier_pdf_pages (grouped by filename)
  const { data: pdfUploads = [], isLoading } = useQuery({
    queryKey: ["pdf-uploads-manager"],
    queryFn: async () => {
      // Source 1: pdf_uploads table (legacy)
      const { data: uploadsData } = await (supabase.from("pdf_uploads") as any)
        .select(`id, file_name, file_path, storage_path, file_url, created_at, status, supplier_id, is_active, brand, suppliers ( id, name )`)
        .order("created_at", { ascending: false });
      const uploads = ((uploadsData || []) as PDFUploadRow[]).map((u) => ({
        ...u,
        is_active: u.is_active !== false,
        can_activate: true,
      }));

      // Source 2: supplier_pdf_pages table (used by import pipeline)
      const { data: pagesData } = await (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, page_image_url, uploaded_at, pdf_storage_path");
      const pages = pagesData || [];

      // Group pages by supplier_id + pdf_filename
      const pageGroups: Record<string, any[]> = {};
      for (const p of pages) {
        const key = `${p.supplier_id}::${p.pdf_filename}`;
        if (!pageGroups[key]) pageGroups[key] = [];
        pageGroups[key].push(p);
      }

      // Build a set of filenames already covered by pdf_uploads
      const coveredFiles = new Set(uploads.map(u => u.file_name).filter(Boolean));

      // Get all suppliers to resolve names → UUIDs
      const { data: allSuppliers } = await supabase.from("suppliers").select("id, name");
      const supplierByName: Record<string, { id: string; name: string }> = {};
      const supplierById: Record<string, { id: string; name: string }> = {};
      for (const s of allSuppliers || []) {
        supplierByName[s.name.toLowerCase().trim()] = s;
        supplierById[s.id] = s;
      }

      // Create synthetic PDFUploadRow entries from supplier_pdf_pages groups
      for (const [key, groupPages] of Object.entries(pageGroups)) {
        const filename = groupPages[0].pdf_filename;
        if (coveredFiles.has(filename)) continue; // already in pdf_uploads

        const supplierIdText = groupPages[0].supplier_id?.trim() || "";
        // Resolve supplier: try by UUID first, then by name
        const resolvedSupplier = supplierById[supplierIdText]
          || supplierByName[supplierIdText.toLowerCase()]
          || null;

        const syntheticId = `spp-${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const pdfStoragePath = groupPages.find((p: any) => p.pdf_storage_path)?.pdf_storage_path || null;

        uploads.push({
          id: syntheticId,
          file_name: filename,
          file_path: pdfStoragePath,
          storage_path: pdfStoragePath,
          file_url: pdfStoragePath,
          created_at: groupPages[0].uploaded_at || new Date().toISOString(),
          status: "parsed",
          supplier_id: resolvedSupplier?.id || supplierIdText,
          suppliers: resolvedSupplier ? { id: resolvedSupplier.id, name: resolvedSupplier.name } : null,
          is_active: true,
          brand: null,
          can_activate: false,
        });
      }

      // Sort by date descending
      uploads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return uploads;
    },
  });

  // Fetch product counts per PDF (by pdf_upload_id + by supplier_id for synthetic entries)
  const { data: productCounts = {} } = useQuery({
    queryKey: ["pdf-product-counts", pdfUploads.map((p) => p.id).join(",")],
    enabled: pdfUploads.length > 0,
    queryFn: async () => {
      const counts: Record<string, number> = {};

      // Real pdf_upload_id counts
      const realIds = pdfUploads.filter(p => !p.id.startsWith("spp-")).map(p => p.id);
      if (realIds.length > 0) {
        const { data } = await (supabase.from("supplier_products") as any)
          .select("id, pdf_upload_id")
          .in("pdf_upload_id", realIds);
        for (const row of data || []) {
          counts[row.pdf_upload_id] = (counts[row.pdf_upload_id] || 0) + 1;
        }
      }

      // Fallback: for real entries with 0 products by pdf_upload_id, count by supplier_id
      const realEntries = pdfUploads.filter(p => !p.id.startsWith("spp-"));
      for (const entry of realEntries) {
        if (!counts[entry.id] && entry.supplier_id) {
          const { count } = await (supabase.from("supplier_products") as any)
            .select("id", { count: "exact", head: true })
            .eq("supplier_id", entry.supplier_id);
          counts[entry.id] = count || 0;
        }
      }

      // For synthetic entries, count products by supplier_id
      const syntheticEntries = pdfUploads.filter(p => p.id.startsWith("spp-"));
      for (const entry of syntheticEntries) {
        const { count } = await (supabase.from("supplier_products") as any)
          .select("id", { count: "exact", head: true })
          .eq("supplier_id", entry.supplier_id);
        counts[entry.id] = count || 0;
      }

      return counts;
    },
  });

  // Fetch suppliers for filter dropdown
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-list-filter"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id, name").order("name");
      return data || [];
    },
  });

  // Filter
  const filtered = useMemo(() => {
    return pdfUploads.filter((pdf) => {
      if (supplierFilter !== "all" && pdf.supplier_id !== supplierFilter) return false;
      if (statusFilter !== "all" && (pdf.status || "pending") !== statusFilter) return false;
      if (searchTerm && !(pdf.file_name || "").toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [pdfUploads, supplierFilter, statusFilter, searchTerm]);

  // Stats
  const totalProducts = Object.values(productCounts).reduce((a, b) => a + b, 0);

  const handleDeleteClick = async (pdf: PDFUploadRow) => {
    const { count } = await (supabase.from("supplier_products") as any)
      .select("id", { count: "exact", head: true })
      .eq("pdf_upload_id", pdf.id);
    setDeleteProductCount(count ?? productCounts[pdf.id] ?? 0);
    setDeleteTarget(pdf);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteSinglePDF(deleteTarget);
      toast({
        title: `${deleteTarget.file_name || "PDF"} deleted`,
        description: `${result.productsDeleted} products removed.`,
      });
      queryClient.invalidateQueries({ queryKey: ["pdf-uploads-manager"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-product-counts"] });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleBulkDelete = async () => {
    const targets = filtered.filter((p) => selectedIds.has(p.id));
    setBulkDeleting(true);
    setBulkProgress({ current: 0, total: targets.length });
    let totalProducts = 0;
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ current: i + 1, total: targets.length });
      const result = await deleteSinglePDF(targets[i]);
      totalProducts += result.productsDeleted;
    }
    toast({
      title: `${targets.length} PDFs deleted`,
      description: `${totalProducts} products removed.`,
    });
    setSelectedIds(new Set());
    setBulkDeleting(false);
    queryClient.invalidateQueries({ queryKey: ["pdf-uploads-manager"] });
    queryClient.invalidateQueries({ queryKey: ["pdf-product-counts"] });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const handlePreview = async (pdf: PDFUploadRow) => {
    const previewName = pdf.file_name || "Selected PDF";

    try {
      setPreviewOpen(true);
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewFileName(previewName);
      setPreviewDebugMessage(`[Preview Debug] Opening preview for ${previewName}`);
      setPreviewUrl((current) => {
        clearPreviewUrl(current);
        return null;
      });

      toast({
        title: "[Preview Debug] Opening preview...",
        description: previewName,
      });

      const candidates = buildPreviewCandidates(pdf);
      if (candidates.length === 0) {
        throw new Error("No file path found for this PDF");
      }

      let lastError: Error | null = null;

      for (const candidate of candidates) {
        try {
          setPreviewDebugMessage(`[Preview Debug] Trying ${candidate.label}`);

          let blob: Blob;

          if (candidate.bucket && candidate.path) {
            const { data, error } = await supabase.storage.from(candidate.bucket).createSignedUrl(candidate.path, 60);
            if (error) throw new Error(error.message);
            if (!data?.signedUrl) throw new Error("Signed URL was not created");

            blob = await fetchPdfBlob(data.signedUrl, previewName);
          } else if (candidate.directUrl) {
            blob = await fetchPdfBlob(candidate.directUrl, previewName);
          } else {
            throw new Error("Preview candidate is missing a usable source");
          }

          const nextBlobUrl = URL.createObjectURL(blob);

          setPreviewUrl((current) => {
            clearPreviewUrl(current);
            return nextBlobUrl;
          });

          const sizeKb = Math.max(1, Math.round(blob.size / 1024));
          setPreviewDebugMessage(`[Preview Debug] Preview ready from ${candidate.label} (${sizeKb} KB)`);
          toast({
            title: "[Preview Debug] Blob loaded successfully",
            description: `${sizeKb} KB PDF ready`,
          });
          return;
        } catch (candidateError: any) {
          lastError = candidateError instanceof Error ? candidateError : new Error(candidateError?.message || "Unknown preview error");
          setPreviewDebugMessage(`[Preview Debug] ${candidate.label} failed: ${lastError.message}`);
        }
      }

      throw lastError || new Error("Could not load PDF from any storage path");
    } catch (err: any) {
      const message = err.message || "Could not load PDF preview";
      setPreviewError(message);
      setPreviewDebugMessage(`[Preview Debug] Preview failed: ${message}`);
      toast({
        title: "Preview failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{pdfUploads.length}</p>
              <p className="text-xs text-muted-foreground">Total PDFs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalProducts}</p>
              <p className="text-xs text-muted-foreground">Products from PDFs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{pdfUploads.length}</p>
              <p className="text-xs text-muted-foreground">Files in Storage</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Purge Orphaned Products */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setPurgingOrphans(true);
            try {
              // Find products whose pdf_upload_id no longer exists in pdf_uploads
              const pdfIds = pdfUploads.map(p => p.id);
              const { data: orphans } = await (supabase.from("supplier_products") as any)
                .select("id, pdf_upload_id")
                .not("pdf_upload_id", "is", null);
              const orphanProducts = (orphans || []).filter((p: any) => !pdfIds.includes(p.pdf_upload_id));
              if (orphanProducts.length === 0) {
                toast({ title: "No orphaned products found", description: "All products are linked to existing PDFs." });
              } else {
                const orphanIds = orphanProducts.map((p: any) => p.id);
                for (let i = 0; i < orphanIds.length; i += 500) {
                  const batch = orphanIds.slice(i, i + 500);
                  await (supabase.from("quote_items") as any).delete().in("product_id", batch);
                  await (supabase.from("job_used_parts") as any).delete().in("product_id", batch);
                  await (supabase.from("inventory_stock") as any).delete().in("product_id", batch);
                  await (supabase.from("bundle_items") as any).delete().in("supplier_product_id", batch);
                  await (supabase.from("supplier_products") as any).delete().in("id", batch);
                }
                toast({ title: `Purged ${orphanProducts.length} orphaned products`, description: "Products from deleted PDFs have been removed." });
                queryClient.invalidateQueries({ queryKey: ["pdf-product-counts"] });
              }
            } catch (err: any) {
              toast({ title: "Purge failed", description: err.message, variant: "destructive" });
            } finally {
              setPurgingOrphans(false);
            }
          }}
          disabled={purgingOrphans}
        >
          {purgingOrphans ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
          Purge Orphaned Products
        </Button>
        <span className="text-xs text-muted-foreground">Remove products whose source PDF no longer exists</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search file name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="parsed">Parsed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
          >
            {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Delete Selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            Deselect All
          </Button>
          {bulkDeleting && (
            <div className="flex-1 max-w-xs">
              <Progress value={(bulkProgress.current / bulkProgress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                Deleting {bulkProgress.current} of {bulkProgress.total}...
              </p>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Database className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>No PDF uploads found</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((pdf) => (
                <TableRow key={pdf.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(pdf.id)}
                      onCheckedChange={() => toggleSelect(pdf.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{pdf.suppliers?.name || "Unknown"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[200px]">{pdf.file_name || "Untitled"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(pdf.created_at), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        (pdf.status || "pending") === "parsed" ? "default" :
                        (pdf.status || "pending") === "failed" ? "destructive" : "secondary"
                      }
                      className="text-xs"
                    >
                      {pdf.status || "pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {productCounts[pdf.id] || 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handlePreview(pdf)}
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(pdf)}
                        title="Delete"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete PDF Catalog
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="rounded-lg bg-muted p-3 space-y-1">
                  <p><span className="font-medium">📄 File:</span> {deleteTarget?.file_name}</p>
                  <p><span className="font-medium">Supplier:</span> {deleteTarget?.suppliers?.name}</p>
                  <p><span className="font-medium">Uploaded:</span> {deleteTarget ? format(new Date(deleteTarget.created_at), "dd MMM yyyy HH:mm") : ""}</p>
                </div>
                <p className="text-destructive font-medium">
                  ⚠️ This will also delete {deleteProductCount} products parsed from this PDF.
                </p>
                <p className="text-muted-foreground">
                  If these products appear in any quotes, those line items will be cleared.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete PDF & Products
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PDF Preview */}
      <Dialog open={previewOpen} onOpenChange={(open) => {
        if (!open) {
          resetPreviewState();
        }
      }}>
        <DialogContent className="max-w-[95vw] w-[1150px] h-[92vh] max-h-[95vh] flex flex-col p-0">
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
            <DialogTitle className="text-sm font-semibold">PDF Preview</DialogTitle>
            <div className="flex items-center gap-1.5">
              {previewUrl && (
                <>
                  <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a>
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                    <a href={previewUrl} download={previewFileName || "supplier-document.pdf"}>Download</a>
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {previewDebugMessage && (
              <div className="shrink-0 border-b bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground">
                {previewDebugMessage}
              </div>
            )}

            {previewLoading ? (
              <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading preview...</span>
              </div>
            ) : previewError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center text-muted-foreground">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Preview failed</p>
                  <p className="text-sm text-muted-foreground">{previewError}</p>
                </div>
                {previewUrl && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={previewUrl} download={previewFileName || "supplier-document.pdf"}>Download PDF</a>
                    </Button>
                  </div>
                )}
              </div>
            ) : previewUrl ? (
              <div className="flex-1 p-6 bg-muted/30 overflow-hidden">
                <PdfPreviewEmbed url={previewUrl} fileName={previewFileName} />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                No preview selected.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplierPDFManager;

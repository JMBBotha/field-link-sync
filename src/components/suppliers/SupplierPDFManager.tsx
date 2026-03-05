import { useState, useMemo } from "react";
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
  FileText, Trash2, Eye, Search, Loader2, AlertTriangle, Database, HardDrive, Package,
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
}

interface SupplierPDFManagerProps {
  preFilterSupplierId?: string;
}

const STORAGE_BUCKETS = ["supplier-pdf-pages", "stock-documents", "product-image", "pdfs", "price-lists"];

async function deleteSinglePDF(pdf: PDFUploadRow) {
  // 1. Get products linked to this PDF
  const { data: products } = await (supabase.from("supplier_products") as any)
    .select("id")
    .eq("pdf_upload_id", pdf.id);
  const productIds = (products || []).map((p: any) => p.id);

  // 2. Delete dependent records
  if (productIds.length > 0) {
    for (let i = 0; i < productIds.length; i += 500) {
      const batch = productIds.slice(i, i + 500);
      await (supabase.from("quote_items") as any).delete().in("product_id", batch);
      await (supabase.from("job_used_parts") as any).delete().in("product_id", batch);
      await (supabase.from("inventory_stock") as any).delete().in("product_id", batch);
      await (supabase.from("bundle_items") as any).delete().in("supplier_product_id", batch);
      await (supabase.from("supplier_products") as any).delete().in("id", batch);
    }
  }

  // 3. Delete PDF region overlays
  await (supabase.from("pdf_product_regions") as any).delete().eq("pdf_upload_id", pdf.id);

  // 4. Delete supplier_pdf_pages linked to this supplier
  // supplier_pdf_pages uses text supplier_id (name) so we need to match by supplier name
  const supplierName = pdf.suppliers?.name;
  if (supplierName) {
    // Delete pages matching this supplier name (with and without trailing space)
    await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", supplierName);
    await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", supplierName + " ");
    // Also try matching by the pdf filename
    if (pdf.file_name) {
      await (supabase.from("supplier_pdf_pages") as any).delete().eq("pdf_filename", pdf.file_name);
    }
  }
  // Also delete by supplier UUID in case some pages use UUID format
  await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", pdf.supplier_id);

  // 5. Delete the pdf_uploads DB record
  await (supabase.from("pdf_uploads") as any).delete().eq("id", pdf.id);

  // 6. Delete actual file from storage
  const rawPath = pdf.file_path || pdf.storage_path || pdf.file_url || null;
  if (rawPath) {
    const match = rawPath.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
    const cleanPath = match ? match[1] : rawPath;
    for (const bucket of STORAGE_BUCKETS) {
      try { await supabase.storage.from(bucket).remove([cleanPath]); } catch {}
    }
  }

  return { success: true, productsDeleted: productIds.length };
}

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [purgingOrphans, setPurgingOrphans] = useState(false);

  // Fetch all PDFs
  const { data: pdfUploads = [], isLoading } = useQuery({
    queryKey: ["pdf-uploads-manager"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("pdf_uploads") as any)
        .select(`id, file_name, file_path, storage_path, file_url, created_at, status, supplier_id, suppliers ( id, name )`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PDFUploadRow[];
    },
  });

  // Fetch product counts per PDF
  const { data: productCounts = {} } = useQuery({
    queryKey: ["pdf-product-counts", pdfUploads.map((p) => p.id).join(",")],
    enabled: pdfUploads.length > 0,
    queryFn: async () => {
      const counts: Record<string, number> = {};
      // Batch: get all products with pdf_upload_id in our list
      const pdfIds = pdfUploads.map((p) => p.id);
      const { data } = await (supabase.from("supplier_products") as any)
        .select("id, pdf_upload_id")
        .in("pdf_upload_id", pdfIds);
      for (const row of data || []) {
        counts[row.pdf_upload_id] = (counts[row.pdf_upload_id] || 0) + 1;
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
    // Try all path fields in priority order
    const candidates = [pdf.file_url, pdf.file_path, pdf.storage_path].filter(Boolean) as string[];
    console.log("[PDFManager] Preview candidates:", candidates, "supplier:", pdf.suppliers?.name);

    for (const rawPath of candidates) {
      // If it's already a full URL, use directly
      if (rawPath.startsWith("http")) {
        setPreviewUrl(rawPath);
        return;
      }

      // Try to extract bucket/path from Supabase storage URL patterns
      const match = rawPath.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
      if (match) {
        const { data } = supabase.storage.from(match[1]).getPublicUrl(match[2]);
        setPreviewUrl(data.publicUrl);
        return;
      }

      // It's a raw path like "uuid/filename.pdf" — try known PDF buckets
      const pdfBuckets = ["pdfs", "price-lists", "supplier-pdf-pages", "stock-documents"];
      for (const bucket of pdfBuckets) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(rawPath);
        // Verify the file actually exists by trying to fetch headers
        try {
          const resp = await fetch(data.publicUrl, { method: "HEAD" });
          if (resp.ok) {
            console.log("[PDFManager] Found PDF in bucket:", bucket, "path:", rawPath);
            setPreviewUrl(data.publicUrl);
            return;
          }
        } catch {}
      }
    }

    // Last resort: construct URL from file_path with 'pdfs' bucket
    const fallback = candidates[0];
    if (fallback) {
      const { data } = supabase.storage.from("pdfs").getPublicUrl(fallback);
      console.log("[PDFManager] Fallback URL:", data.publicUrl);
      setPreviewUrl(data.publicUrl);
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
      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>PDF Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <iframe
              src={previewUrl}
              className="w-full flex-1 rounded border min-h-0"
              style={{ height: "calc(80vh - 80px)" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplierPDFManager;

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Building2, Plus, Search, Users, Package, MoreVertical, Trash2,
  AlertTriangle, ChevronDown, Loader2, ShieldAlert, Download, FileUp, FileSpreadsheet,
} from "lucide-react";
import SupplierDetailSheet from "@/components/suppliers/SupplierDetailSheet";
import SupplierFormDialog from "@/components/suppliers/SupplierFormDialog";
import SupplierProductImporter from "@/components/catalog/SupplierProductImporter";
import { useToast } from "@/hooks/use-toast";
import {
  deleteSupplierCompletely,
  deleteSupplierProductsOnly,
  deleteAllSuppliersCompletely,
  getSupplierDeleteCounts,
  getOrphanProductCount,
  cleanOrphanProducts,
} from "@/services/supplierDeleteService";
import { cleanSupplierProducts } from "@/services/priceListDeleteService";

interface SupplierRow {
  id: string;
  name: string;
  company_name: string | null;
  trading_name: string | null;
  contact_email: string | null;
  website: string | null;
  supplier_type: string;
  is_active: boolean;
}

type DeleteMode = "products" | "complete";

interface DeleteState {
  supplierId: string;
  supplierName: string;
  mode: DeleteMode;
  counts: { products: number; pdfs: number; contacts: number };
}

const AdminSuppliersPage = () => {
  const [search, setSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [expandedImportId, setExpandedImportId] = useState<string | null>(null);

  // Bulk delete state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirmText, setBulkConfirmText] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  // Orphan check
  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["admin-suppliers-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as unknown as SupplierRow[];
    },
  });

  const { data: contactCounts = {} } = useQuery({
    queryKey: ["supplier-contact-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_contacts") as any).select("supplier_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => { counts[r.supplier_id] = (counts[r.supplier_id] || 0) + 1; });
      return counts;
    },
  });

  const { data: productCounts = {} } = useQuery({
    queryKey: ["supplier-product-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("supplier_id")
        .or("archived.is.null,archived.eq.false");
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => { counts[r.supplier_id] = (counts[r.supplier_id] || 0) + 1; });
      return counts;
    },
  });

  // Last import info per supplier
  const { data: lastImports = {} } = useQuery({
    queryKey: ["supplier-last-imports"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("import_audit_log") as any)
        .select("supplier_id, created_at, products_imported, file_name, action")
        .in("action", ["pdf_import", "csv_import"])
        .order("created_at", { ascending: false });
      if (error) return {};
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => {
        if (!map[r.supplier_id]) map[r.supplier_id] = r;
      });
      return map;
    },
  });

  const filtered = suppliers.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.company_name?.toLowerCase().includes(q) ||
      s.trading_name?.toLowerCase().includes(q) || s.contact_email?.toLowerCase().includes(q);
  });

  const handleEdit = (id: string) => { setEditingSupplierId(id); setFormOpen(true); };
  const handleAdd = () => { setEditingSupplierId(null); setFormOpen(true); };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers-list"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-contact-counts"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-last-imports"] });
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
    queryClient.invalidateQueries({ queryKey: ["consumable-products"] });
    runOrphanCheck();
  };

  const runOrphanCheck = async () => {
    try {
      const count = await getOrphanProductCount();
      setOrphanCount(count);
    } catch { setOrphanCount(null); }
  };

  useEffect(() => { runOrphanCheck(); }, []);

  const handleCleanOrphans = async () => {
    setCleaningOrphans(true);
    try {
      const cleaned = await cleanOrphanProducts();
      toast({ title: `${cleaned} orphan products cleaned up` });
      setOrphanCount(0);
      refreshAll();
    } catch (err: any) {
      toast({ title: "Cleanup failed", description: err.message, variant: "destructive" });
    } finally {
      setCleaningOrphans(false);
    }
  };

  const openDeleteDialog = async (supplier: SupplierRow, mode: DeleteMode) => {
    const counts = await getSupplierDeleteCounts(supplier.id);
    setDeleteState({ supplierId: supplier.id, supplierName: supplier.company_name || supplier.name, mode, counts });
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    setIsDeleting(true);
    try {
      if (deleteState.mode === "complete") {
        const result = await deleteSupplierCompletely(deleteState.supplierId);
        toast({
          title: `${deleteState.supplierName} removed completely.`,
          description: `${result.deletedProducts} products, ${result.deletedPdfPages} PDF pages removed.`,
        });
      } else {
        const result = await deleteSupplierProductsOnly(deleteState.supplierId);
        toast({
          title: `${deleteState.supplierName} cleared — ready for fresh upload.`,
          description: `${result.deletedProducts} products, ${result.deletedPdfPages} PDF pages removed.`,
        });
      }
      refreshAll();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setDeleteState(null);
    }
  };

  const handleBulkDeleteAll = async () => {
    setBulkOpen(false);
    setBulkConfirmText("");
    try {
      await deleteAllSuppliersCompletely((current, total, name) => {
        setBulkProgress({ current, total, name });
      });
      setBulkProgress(null);
      toast({ title: "All suppliers deleted. Database is clean." });
      refreshAll();
    } catch (err: any) {
      setBulkProgress(null);
      toast({ title: "Bulk delete failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Supplier Database
          </h2>
          <p className="text-sm text-muted-foreground">{suppliers.length} suppliers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={async () => {
            const { data: allContacts } = await (supabase.from("supplier_contacts") as any)
              .select("contact_name, department, email, phone, mobile, whatsapp, location_branch, role_title, supplier_id");
            const { data: allLocations } = await (supabase.from("supplier_locations") as any)
              .select("supplier_id, location_name, city, phone, email, whatsapp, address");
            const rows: string[] = ["Supplier,Location,Department,Contact Name,Email,Phone,WhatsApp,Role"];
            for (const s of suppliers) {
              const sContacts = (allContacts || []).filter((c: any) => c.supplier_id === s.id);
              const sLocations = (allLocations || []).filter((l: any) => l.supplier_id === s.id);
              if (sContacts.length === 0 && sLocations.length === 0) {
                rows.push(`"${s.name}",,,,,,`);
              }
              for (const loc of sLocations) {
                const locContacts = sContacts.filter((c: any) => c.location_branch === loc.location_name || c.location_branch === loc.city);
                if (locContacts.length === 0) {
                  rows.push(`"${s.name}","${loc.location_name}",,"","${loc.email || ""}","${loc.phone || ""}","${loc.whatsapp || ""}",""`);
                }
              }
              for (const c of sContacts) {
                rows.push(`"${s.name}","${c.location_branch || ""}","${c.department || ""}","${c.contact_name}","${c.email || ""}","${c.phone || c.mobile || ""}","${c.whatsapp || ""}","${c.role_title || ""}"`);
              }
            }
            const blob = new Blob([rows.join("\n")], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = "supplier-contacts.csv"; a.click();
            URL.revokeObjectURL(url);
            toast({ title: "Contacts exported" });
          }}>
            <Download className="h-4 w-4 mr-1" /> Export Contacts
          </Button>
          <Button onClick={handleAdd} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Supplier
          </Button>
        </div>
      </div>

      {/* Orphan warning */}
      {orphanCount !== null && orphanCount > 0 && (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="font-medium text-yellow-700">
                ⚠️ {orphanCount} orphan product{orphanCount !== 1 ? "s" : ""} found with no supplier
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={handleCleanOrphans} disabled={cleaningOrphans} className="text-xs">
              {cleaningOrphans ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
              Clean Orphans
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      {suppliers.length > 0 && (
        <Collapsible open={dangerOpen} onOpenChange={setDangerOpen}>
          <Card className="border-destructive/30">
            <CardContent className="p-0">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between p-3 hover:bg-destructive/5 transition-colors rounded-lg">
                  <span className="text-sm font-medium flex items-center gap-2 text-destructive">
                    <ShieldAlert className="h-4 w-4" />
                    ⚠️ Danger Zone
                  </span>
                  <ChevronDown className={`h-4 w-4 text-destructive transition-transform ${dangerOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Delete ALL suppliers and their associated products, PDFs, contacts, and documents.
                    This action is irreversible.
                  </p>
                  {bulkProgress && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-destructive">
                        Deleting {bulkProgress.current} of {bulkProgress.total} suppliers...
                        <span className="text-muted-foreground ml-1">({bulkProgress.name})</span>
                      </p>
                      <Progress value={(bulkProgress.current / bulkProgress.total) * 100} className="h-2" />
                    </div>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => setBulkOpen(true)} disabled={!!bulkProgress}>
                    <AlertTriangle className="h-4 w-4 mr-1" /> Delete ALL {suppliers.length} Suppliers
                  </Button>
                </div>
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading suppliers...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? "No suppliers match your search" : "No suppliers yet. Add your first supplier."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company Name</TableHead>
                  <TableHead className="hidden md:table-cell">Trading Name</TableHead>
                  <TableHead className="text-center"><Users className="h-4 w-4 mx-auto" /></TableHead>
                  <TableHead className="text-center"><Package className="h-4 w-4 mx-auto" /></TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Import</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const li = lastImports[s.id];
                  return (
                    <TableRow key={s.id} className="group">
                      {/* Supplier row */}
                      <TableCell className="font-medium cursor-pointer" onClick={() => setSelectedSupplierId(s.id)}>
                        {s.company_name || s.name}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground cursor-pointer" onClick={() => setSelectedSupplierId(s.id)}>
                        {s.trading_name || "—"}
                      </TableCell>
                      <TableCell className="text-center cursor-pointer" onClick={() => setSelectedSupplierId(s.id)}>
                        <Badge variant="secondary" className="text-xs">{contactCounts[s.id] || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center cursor-pointer" onClick={() => setSelectedSupplierId(s.id)}>
                        <Badge variant="outline" className="text-xs">{productCounts[s.id] || 0}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell cursor-pointer" onClick={() => setSelectedSupplierId(s.id)}>
                        <Badge variant={s.supplier_type === "consumables" ? "default" : "secondary"} className="text-xs">
                          {s.supplier_type === "consumables" ? "Consumables" : "AC Units"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {li ? (
                          <span>
                            {new Date(li.created_at).toLocaleDateString()} ({li.products_imported} from {li.file_name?.substring(0, 20)})
                          </span>
                        ) : (
                          <span className="italic">No imports yet</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {/* Quick upload button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Upload PDF/CSV Price List"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedImportId(expandedImportId === s.id ? null : s.id);
                            }}
                          >
                            <FileUp className="h-4 w-4 text-primary" />
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setExpandedImportId(expandedImportId === s.id ? null : s.id)}>
                                <FileUp className="h-4 w-4 mr-2" /> Upload & Parse PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setExpandedImportId(expandedImportId === s.id ? null : s.id)}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" /> Upload & Parse CSV
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={async () => {
                                try {
                                  const result = await cleanSupplierProducts(s.id);
                                  toast({
                                    title: `${s.company_name || s.name}: ${result.deletedProducts} products removed`,
                                    description: "All products for this supplier have been cleaned up.",
                                  });
                                  refreshAll();
                                } catch (err: any) {
                                  toast({ title: "Clean failed", description: err.message, variant: "destructive" });
                                }
                              }}>
                                <Package className="h-4 w-4 mr-2" /> Clean Products Only
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDeleteDialog(s, "products")}>
                                <Trash2 className="h-4 w-4 mr-2" /> Clear Products & PDFs
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => openDeleteDialog(s, "complete")}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete Supplier Completely
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Inline import panels (rendered outside table for proper layout) */}
      {filtered.map((s) => expandedImportId === s.id && (
        <Card key={`import-${s.id}`} className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">
                📄 Import Products — {s.company_name || s.name}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setExpandedImportId(null)} className="text-xs">
                Cancel
              </Button>
            </div>
            {/* Safe diff-based importer — archives missing products instead of
                hard-deleting the whole catalog on every import. See
                docs/pricing-and-import-architecture-findings.md */}
            <SupplierProductImporter
              supplierId={s.id}
              supplierName={s.company_name || s.name}
              isConsumablesSupplier={s.supplier_type === "consumables"}
              onComplete={() => {
                setExpandedImportId(null);
                refreshAll();
              }}
            />
          </CardContent>
        </Card>
      ))}

      {/* Single delete confirmation */}
      <AlertDialog open={!!deleteState} onOpenChange={(o) => !o && setDeleteState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteState?.mode === "complete" ? "💥 Delete Supplier Completely?" : "🗑️ Clear Products & PDFs?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="font-medium text-foreground text-base">{deleteState?.supplierName}</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>{deleteState?.counts.products ?? 0} products will be deleted</li>
                  <li>{deleteState?.counts.pdfs ?? 0} PDF catalogs will be removed</li>
                  <li>PDF files will be permanently deleted from storage</li>
                  {deleteState?.mode === "complete" && (
                    <li>{deleteState?.counts.contacts ?? 0} contacts will be removed</li>
                  )}
                </ul>
                {deleteState?.mode === "products" && (
                  <p className="text-sm text-muted-foreground">
                    Supplier info will be kept intact — ready for re-upload.
                  </p>
                )}
                {deleteState?.mode === "complete" && (
                  <p className="text-destructive font-semibold text-sm border border-destructive/30 rounded-md p-2 bg-destructive/5">
                    ⚠️ This also removes all contacts, the supplier record, and all uploaded PDF files. This cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Deleting...</>
              ) : deleteState?.mode === "complete" ? (
                "Yes, Delete Everything"
              ) : (
                "Confirm Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete all confirmation */}
      <AlertDialog open={bulkOpen} onOpenChange={(o) => { if (!o) { setBulkOpen(false); setBulkConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete ALL {suppliers.length} Suppliers?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will permanently delete <strong>every supplier</strong>, all their products,
                  PDF catalogs, contacts, documents, and dependent records.
                </p>
                <p className="text-destructive font-semibold">This action cannot be undone.</p>
                <div>
                  <p className="text-sm mb-1">
                    Type <span className="font-mono font-bold bg-muted px-1 rounded">DELETE ALL</span> to confirm:
                  </p>
                  <Input
                    value={bulkConfirmText}
                    onChange={(e) => setBulkConfirmText(e.target.value)}
                    placeholder="DELETE ALL"
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDeleteAll}
              disabled={bulkConfirmText !== "DELETE ALL"}
            >
              Delete All Suppliers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail sheet */}
      {selectedSupplierId && (
        <SupplierDetailSheet
          supplierId={selectedSupplierId}
          open={!!selectedSupplierId}
          onOpenChange={(o) => !o && setSelectedSupplierId(null)}
          onEdit={() => handleEdit(selectedSupplierId)}
        />
      )}

      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} supplierId={editingSupplierId} />

    </div>
  );
};

export default AdminSuppliersPage;

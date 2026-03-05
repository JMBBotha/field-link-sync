import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building2, Plus, Search, Users, Package, MoreVertical, Trash2, AlertTriangle } from "lucide-react";
import SupplierDetailSheet from "@/components/suppliers/SupplierDetailSheet";
import SupplierFormDialog from "@/components/suppliers/SupplierFormDialog";
import FloatingQuoteBuilderButton from "@/components/shared/FloatingQuoteBuilderButton";
import { useToast } from "@/hooks/use-toast";
import {
  deleteSupplierCompletely,
  deleteSupplierProductsOnly,
  getSupplierDeleteCounts,
} from "@/services/supplierDeleteService";

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

  // Bulk-delete-all state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirmText, setBulkConfirmText] = useState("");
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

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

  const filtered = suppliers.filter((s) => {
    const q = search.toLowerCase();
    return (
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.company_name?.toLowerCase().includes(q) ||
      s.trading_name?.toLowerCase().includes(q) ||
      s.contact_email?.toLowerCase().includes(q)
    );
  });

  const handleEdit = (id: string) => { setEditingSupplierId(id); setFormOpen(true); };
  const handleAdd = () => { setEditingSupplierId(null); setFormOpen(true); };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-suppliers-list"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-contact-counts"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
  };

  // --- Single supplier delete actions ---
  const openDeleteDialog = async (supplier: SupplierRow, mode: DeleteMode) => {
    const counts = await getSupplierDeleteCounts(supplier.id);
    setDeleteState({
      supplierId: supplier.id,
      supplierName: supplier.company_name || supplier.name,
      mode,
      counts,
    });
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    setIsDeleting(true);
    try {
      if (deleteState.mode === "complete") {
        await deleteSupplierCompletely(deleteState.supplierId);
        toast({ title: `${deleteState.supplierName} — deleted completely.` });
      } else {
        await deleteSupplierProductsOnly(deleteState.supplierId);
        toast({ title: `${deleteState.supplierName} — products cleared. Ready for re-upload.` });
      }
      refreshAll();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setDeleteState(null);
    }
  };

  // --- Bulk delete all suppliers ---
  const handleBulkDeleteAll = async () => {
    setBulkOpen(false);
    setBulkConfirmText("");
    for (let i = 0; i < suppliers.length; i++) {
      setBulkProgress(`Deleting ${i + 1} of ${suppliers.length} suppliers...`);
      try {
        await deleteSupplierCompletely(suppliers[i].id);
      } catch (err: any) {
        toast({ title: `Failed on ${suppliers[i].name}`, description: err.message, variant: "destructive" });
      }
    }
    setBulkProgress(null);
    toast({ title: `All ${suppliers.length} suppliers deleted.` });
    refreshAll();
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
        <div className="flex items-center gap-2">
          {suppliers.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setBulkOpen(true)}>
              <AlertTriangle className="h-4 w-4 mr-1" /> Delete ALL Suppliers
            </Button>
          )}
          <Button onClick={handleAdd} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Supplier
          </Button>
        </div>
      </div>

      {/* Bulk progress banner */}
      {bulkProgress && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm font-medium text-destructive">
          {bulkProgress}
        </div>
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
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium" onClick={() => setSelectedSupplierId(s.id)}>
                      {s.company_name || s.name}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground" onClick={() => setSelectedSupplierId(s.id)}>
                      {s.trading_name || "—"}
                    </TableCell>
                    <TableCell className="text-center" onClick={() => setSelectedSupplierId(s.id)}>
                      <Badge variant="secondary" className="text-xs">{contactCounts[s.id] || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center" onClick={() => setSelectedSupplierId(s.id)}>
                      <Badge variant="outline" className="text-xs">{productCounts[s.id] || 0}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" onClick={() => setSelectedSupplierId(s.id)}>
                      <Badge variant={s.supplier_type === "consumables" ? "default" : "secondary"} className="text-xs">
                        {s.supplier_type === "consumables" ? "Consumables" : "AC Units"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Single supplier delete confirmation */}
      <AlertDialog open={!!deleteState} onOpenChange={(o) => !o && setDeleteState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteState?.mode === "complete" ? "Delete Supplier Completely?" : "Clear Products & PDFs?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{deleteState?.supplierName}</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>{deleteState?.counts.products ?? 0} products will be deleted</li>
                  <li>{deleteState?.counts.pdfs ?? 0} PDF catalogs will be removed</li>
                  {deleteState?.mode === "complete" && (
                    <li>{deleteState?.counts.contacts ?? 0} contacts will be removed</li>
                  )}
                </ul>
                {deleteState?.mode === "complete" && (
                  <p className="text-destructive font-semibold text-sm mt-2">
                    ⚠️ This also removes all contacts and the supplier record. This cannot be undone.
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
              {isDeleting ? "Deleting..." : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete all confirmation */}
      <AlertDialog open={bulkOpen} onOpenChange={(o) => { if (!o) { setBulkOpen(false); setBulkConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete ALL {suppliers.length} Suppliers?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>This will permanently delete every supplier, all their products, PDF catalogs, contacts, and dependent records.</p>
                <p className="text-destructive font-semibold">This action cannot be undone.</p>
                <div>
                  <p className="text-sm mb-1">Type <span className="font-mono font-bold">DELETE ALL</span> to confirm:</p>
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
      <FloatingQuoteBuilderButton />
    </div>
  );
};

export default AdminSuppliersPage;

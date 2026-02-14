import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, Plus, Search, Users, Package } from "lucide-react";
import SupplierDetailSheet from "@/components/suppliers/SupplierDetailSheet";
import SupplierFormDialog from "@/components/suppliers/SupplierFormDialog";

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

const AdminSuppliersPage = () => {
  const [search, setSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);

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
      const { data, error } = await supabase
        .from("supplier_contacts" as any)
        .select("supplier_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        counts[r.supplier_id] = (counts[r.supplier_id] || 0) + 1;
      });
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
      (data || []).forEach((r: any) => {
        counts[r.supplier_id] = (counts[r.supplier_id] || 0) + 1;
      });
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

  const handleEdit = (id: string) => {
    setEditingSupplierId(id);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditingSupplierId(null);
    setFormOpen(true);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Supplier Database
          </h2>
          <p className="text-sm text-muted-foreground">{suppliers.length} suppliers</p>
        </div>
        <Button onClick={handleAdd} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Supplier
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

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
                  <TableHead className="text-center">
                    <Users className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="text-center">
                    <Package className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedSupplierId(s.id)}
                  >
                    <TableCell className="font-medium">
                      {s.company_name || s.name}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {s.trading_name || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="text-xs">
                        {contactCounts[s.id] || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs">
                        {productCounts[s.id] || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={s.supplier_type === "consumables" ? "default" : "secondary"} className="text-xs">
                        {s.supplier_type === "consumables" ? "Consumables" : "AC Units"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedSupplierId && (
        <SupplierDetailSheet
          supplierId={selectedSupplierId}
          open={!!selectedSupplierId}
          onOpenChange={(o) => !o && setSelectedSupplierId(null)}
          onEdit={() => handleEdit(selectedSupplierId)}
        />
      )}

      <SupplierFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        supplierId={editingSupplierId}
      />
    </div>
  );
};

export default AdminSuppliersPage;

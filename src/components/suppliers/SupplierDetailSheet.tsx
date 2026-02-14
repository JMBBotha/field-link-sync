import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Globe, MapPin, Pencil, Users, Package, FileText } from "lucide-react";
import SupplierContactsTab from "./SupplierContactsTab";
import SupplierDocumentsTab from "./SupplierDocumentsTab";

interface SupplierDetailSheetProps {
  supplierId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

const SupplierDetailSheet = ({ supplierId, open, onOpenChange, onEdit }: SupplierDetailSheetProps) => {
  const { data: supplier } = useQuery({
    queryKey: ["supplier-detail", supplierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("id", supplierId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!supplierId && open,
  });

  const { data: productCount = 0 } = useQuery({
    queryKey: ["supplier-product-count", supplierId],
    queryFn: async () => {
      const { count, error } = await (supabase.from("supplier_products") as any)
        .select("*", { count: "exact", head: true })
        .eq("supplier_id", supplierId)
        .or("archived.is.null,archived.eq.false");
      if (error) throw error;
      return count || 0;
    },
    enabled: !!supplierId && open,
  });

  if (!supplier) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {supplier.company_name || supplier.name}
              </SheetTitle>
              {supplier.trading_name && (
                <p className="text-sm text-muted-foreground mt-1">t/a {supplier.trading_name}</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          </div>
        </SheetHeader>

        {/* Company info card */}
        <Card className="mb-4">
          <CardContent className="p-4 space-y-2 text-sm">
            {supplier.registration_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reg #</span>
                <span>{supplier.registration_number}</span>
              </div>
            )}
            {supplier.vat_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <span>{supplier.vat_number}</span>
              </div>
            )}
            {supplier.website && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" />Website</span>
                <a href={supplier.website.startsWith("http") ? supplier.website : `https://${supplier.website}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline truncate max-w-[200px]">
                  {supplier.website}
                </a>
              </div>
            )}
            {supplier.physical_address && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />Address</span>
                <span className="text-right max-w-[200px]">{supplier.physical_address}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="secondary" className="text-xs">
                {supplier.supplier_type === "consumables" ? "Consumables" : "AC Units"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" />Products</span>
              <span>{productCount}</span>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="contacts">
          <TabsList className="w-full">
            <TabsTrigger value="contacts" className="flex-1 gap-1">
              <Users className="h-3 w-3" /> Contacts
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex-1 gap-1">
              <FileText className="h-3 w-3" /> Documents
            </TabsTrigger>
          </TabsList>
          <TabsContent value="contacts">
            <SupplierContactsTab supplierId={supplierId} />
          </TabsContent>
          <TabsContent value="documents">
            <SupplierDocumentsTab supplierId={supplierId} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default SupplierDetailSheet;

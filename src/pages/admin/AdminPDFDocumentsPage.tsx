import { useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import SupplierPDFManager from "@/components/suppliers/SupplierPDFManager";

const AdminPDFDocumentsPage = () => {
  const [searchParams] = useSearchParams();
  const supplierId = searchParams.get("supplier") || undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          PDF Catalog Manager
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View, preview and delete uploaded supplier price list PDFs
        </p>
      </div>
      <SupplierPDFManager preFilterSupplierId={supplierId} />
    </div>
  );
};

export default AdminPDFDocumentsPage;

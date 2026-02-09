import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import CSVImporter from "@/components/bulk/CSVImporter";

const AdminImportPage = () => {
  const [importTarget, setImportTarget] = useState<"customers" | "inventory_items" | "flat_rate_items">("customers");
  const navigate = useNavigate();

  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">CSV Import</h2>
        </div>
        <div className="flex gap-2 mb-4">
          {(["customers", "inventory_items", "flat_rate_items"] as const).map((t) => (
            <Button
              key={t}
              variant={importTarget === t ? "default" : "outline"}
              size="sm"
              onClick={() => setImportTarget(t)}
              className="capitalize text-xs"
            >
              {t.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
        <CSVImporter
          target={importTarget}
          onComplete={() => navigate("/admin")}
          onClose={() => navigate("/admin")}
        />
      </div>
    </div>
  );
};

export default AdminImportPage;

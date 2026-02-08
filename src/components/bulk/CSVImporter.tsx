import { useState, useCallback } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, X, Check, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type ImportTarget = "customers" | "inventory_items" | "flat_rate_items";

const TARGET_FIELDS: Record<ImportTarget, { field: string; required: boolean; label: string }[]> = {
  customers: [
    { field: "name", required: true, label: "Name" },
    { field: "phone", required: true, label: "Phone" },
    { field: "email", required: false, label: "Email" },
    { field: "address", required: false, label: "Address" },
    { field: "area", required: false, label: "Area" },
    { field: "vat_number", required: false, label: "VAT Number" },
  ],
  inventory_items: [
    { field: "name", required: true, label: "Name" },
    { field: "sku", required: false, label: "SKU" },
    { field: "category", required: false, label: "Category" },
    { field: "quantity_in_stock", required: false, label: "Quantity" },
    { field: "unit_cost", required: false, label: "Unit Cost" },
    { field: "min_stock_level", required: false, label: "Min Stock" },
    { field: "supplier", required: false, label: "Supplier" },
  ],
  flat_rate_items: [
    { field: "name", required: true, label: "Name" },
    { field: "category", required: true, label: "Category" },
    { field: "standard_price", required: true, label: "Price" },
    { field: "description", required: false, label: "Description" },
    { field: "estimated_hours", required: false, label: "Est. Hours" },
  ],
};

interface CSVImporterProps {
  target: ImportTarget;
  onComplete: () => void;
  onClose: () => void;
}

const CSVImporter = ({ target, onComplete, onClose }: CSVImporterProps) => {
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fields = TARGET_FIELDS[target];

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    Papa.parse(file, {
      complete: (results) => {
        const data = results.data as string[][];
        if (data.length < 2) {
          setError("CSV must have at least a header row and one data row");
          return;
        }
        const hdrs = data[0].map((h) => h.trim());
        setHeaders(hdrs);
        setCsvData(data.slice(1).filter((row) => row.some((cell) => cell.trim())));

        // Auto-map matching columns
        const autoMap: Record<string, string> = {};
        fields.forEach((f) => {
          const match = hdrs.findIndex(
            (h) => h.toLowerCase().replace(/[^a-z]/g, "") === f.field.replace(/_/g, "")
          );
          if (match >= 0) autoMap[f.field] = hdrs[match];
        });
        setMapping(autoMap);
      },
      error: () => setError("Failed to parse CSV file"),
    });
  }, [fields]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith(".csv")) {
      setError("Please drop a .csv file");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleFileUpload({ target: input } as any);
  }, [handleFileUpload]);

  const handleImport = async () => {
    // Validate required fields are mapped
    const missingRequired = fields
      .filter((f) => f.required && !mapping[f.field])
      .map((f) => f.label);
    if (missingRequired.length > 0) {
      setError(`Required fields not mapped: ${missingRequired.join(", ")}`);
      return;
    }

    setImporting(true);
    setProgress(0);
    let imported = 0;

    try {
      const rows = csvData.map((row) => {
        const obj: Record<string, any> = {};
        fields.forEach((f) => {
          const csvCol = mapping[f.field];
          if (csvCol) {
            const idx = headers.indexOf(csvCol);
            if (idx >= 0) {
              let val: any = row[idx]?.trim() || null;
              if (val && ["quantity_in_stock", "unit_cost", "min_stock_level", "standard_price", "estimated_hours"].includes(f.field)) {
                val = parseFloat(val) || 0;
              }
              obj[f.field] = val;
            }
          }
        });
        return obj;
      }).filter((obj) => {
        return fields.filter((f) => f.required).every((f) => obj[f.field]);
      });

      // Insert in batches of 50
      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from(target as any)
          .insert(batch as any);
        if (insertError) throw insertError;
        imported += batch.length;
        setProgress(Math.round((imported / rows.length) * 100));
      }

      toast({ title: "Import Complete", description: `${imported} records imported successfully` });
      onComplete();
    } catch (err: any) {
      setError(err.message || "Import failed");
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const previewRows = csvData.slice(0, 5);

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Import {target.replace(/_/g, " ")}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload */}
        {headers.length === 0 && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          >
            <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">Drag & drop a CSV file here, or click to select</p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
            />
            <Button variant="outline" onClick={() => document.getElementById("csv-upload")?.click()}>
              Select CSV File
            </Button>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Column Mapping */}
        {headers.length > 0 && !importing && (
          <>
            <div>
              <h3 className="text-sm font-semibold mb-2">Column Mapping</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fields.map((f) => (
                  <div key={f.field} className="flex items-center gap-2">
                    <span className="text-sm min-w-[100px]">
                      {f.label}{f.required && <span className="text-destructive">*</span>}
                    </span>
                    <Select value={mapping[f.field] || ""} onValueChange={(v) => setMapping((m) => ({ ...m, [f.field]: v }))}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Preview (first 5 rows of {csvData.length})</h3>
              <div className="border rounded-lg overflow-auto max-h-48">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => (
                          <TableCell key={j} className="text-xs py-1">{cell}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setHeaders([]); setCsvData([]); setMapping({}); }}>
                Choose Different File
              </Button>
              <Button onClick={handleImport} className="gap-2">
                <Check className="h-4 w-4" />
                Import {csvData.length} Records
              </Button>
            </div>
          </>
        )}

        {/* Progress */}
        {importing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Importing...</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">{progress}% complete</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CSVImporter;

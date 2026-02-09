import { useState, useCallback } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SupplierProductImporterProps {
  supplierId: string;
  supplierName: string;
  onComplete: () => void;
}

const PRODUCT_FIELDS = [
  { field: "product_code", required: true, label: "Product Code" },
  { field: "description", required: true, label: "Description" },
  { field: "category", required: true, label: "Category" },
  { field: "pipe_size", required: false, label: "Pipe Size" },
  { field: "cost_price", required: true, label: "Nett Price" },
];

const SupplierProductImporter = ({ supplierId, supplierName, onComplete }: SupplierProductImporterProps) => {
  const [tab, setTab] = useState<"csv" | "ai">("csv");
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{ imported: number; updated: number; skipped: number } | null>(null);
  const { toast } = useToast();

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

        // Auto-map
        const autoMap: Record<string, string> = {};
        PRODUCT_FIELDS.forEach((f) => {
          const match = hdrs.findIndex(
            (h) => h.toLowerCase().replace(/[^a-z]/g, "") === f.field.replace(/_/g, "")
          );
          if (match >= 0) autoMap[f.field] = hdrs[match];
        });
        setMapping(autoMap);
      },
      error: () => setError("Failed to parse CSV"),
    });
  }, []);

  const parsePrice = (val: string): number => {
    if (!val) return 0;
    // Handle "R 7 700,00" format
    const cleaned = val.replace(/[Rr\s]/g, "").replace(/,(\d{2})$/, ".$1").replace(/\s/g, "");
    return parseFloat(cleaned) || 0;
  };

  const handleCSVImport = async () => {
    const missingRequired = PRODUCT_FIELDS
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
        const obj: Record<string, any> = { supplier_id: supplierId };
        PRODUCT_FIELDS.forEach((f) => {
          const csvCol = mapping[f.field];
          if (csvCol) {
            const idx = headers.indexOf(csvCol);
            if (idx >= 0) {
              let val: any = row[idx]?.trim() || null;
              if (f.field === "cost_price") {
                const price = parsePrice(val || "");
                obj.cost_price = price;
                obj.is_price_on_request = val?.toUpperCase().includes("POR") || false;
              } else {
                obj[f.field] = val;
              }
            }
          }
        });

        // Extract BTU and refrigerant from description
        if (obj.description) {
          const btuMatch = obj.description.match(/(\d+)\s*(?:000)?\s*BTU/i);
          if (btuMatch) {
            const btu = parseInt(btuMatch[1]);
            obj.btu_rating = btu < 1000 ? btu * 1000 : btu;
          }
          const refMatch = obj.description.match(/R32|R410A|R22/i);
          if (refMatch) obj.refrigerant_type = refMatch[0].toUpperCase();
        }

        obj.default_markup_percent = 30;
        return obj;
      }).filter((obj) => obj.product_code && obj.description);

      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from("supplier_products" as any)
          .insert(batch as any);
        if (insertError) throw insertError;
        imported += batch.length;
        setProgress(Math.round((imported / rows.length) * 100));
      }

      toast({ title: "Import Complete", description: `${imported} products imported` });
      onComplete();
    } catch (err: any) {
      setError(err.message || "Import failed");
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleAIParse = async () => {
    if (!aiText.trim()) {
      setError("Paste the price list text first");
      return;
    }
    setAiParsing(true);
    setError(null);
    setAiResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("parse-price-list", {
        body: { csv_text: aiText, supplier_id: supplierId, supplier_name: supplierName },
      });

      if (fnError) throw fnError;
      if (data?.error && !data?.success) throw new Error(data.error);

      setAiResult({ imported: data.imported, updated: data.updated, skipped: data.skipped });
      toast({ title: "AI Parse Complete", description: `${data.imported} new, ${data.updated} updated, ${data.skipped} skipped` });
      if (data.imported > 0 || data.updated > 0) onComplete();
    } catch (err: any) {
      setError(err.message || "AI parsing failed");
      toast({ title: "AI Parse Failed", description: err.message, variant: "destructive" });
    } finally {
      setAiParsing(false);
    }
  };

  const previewRows = csvData.slice(0, 5);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Import Products for {supplierName}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="csv" className="text-xs">
              <Upload className="h-3 w-3 mr-1" /> CSV Upload
            </TabsTrigger>
            <TabsTrigger value="ai" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" /> AI PDF Parse
            </TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-3 mt-3">
            {headers.length === 0 && !importing && (
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2">Upload a CSV with product data</p>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" id="product-csv" />
                <Button variant="outline" size="sm" onClick={() => document.getElementById("product-csv")?.click()}>
                  Select CSV File
                </Button>
              </div>
            )}

            {headers.length > 0 && !importing && (
              <>
                <div>
                  <h4 className="text-xs font-semibold mb-2">Map Columns</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PRODUCT_FIELDS.map((f) => (
                      <div key={f.field} className="flex items-center gap-2">
                        <span className="text-xs min-w-[90px]">
                          {f.label}{f.required && <span className="text-destructive">*</span>}
                        </span>
                        <Select value={mapping[f.field] || ""} onValueChange={(v) => setMapping((m) => ({ ...m, [f.field]: v }))}>
                          <SelectTrigger className="h-7 text-xs">
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

                <div className="border rounded-lg overflow-auto max-h-36">
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

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setHeaders([]); setCsvData([]); setMapping({}); }}>
                    Different File
                  </Button>
                  <Button size="sm" onClick={handleCSVImport}>
                    <Check className="h-3 w-3 mr-1" /> Import {csvData.length} Products
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="ai" className="space-y-3 mt-3">
            <div>
              <Label className="text-xs">Paste price list text (from PDF copy-paste)</Label>
              <Textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="Paste the raw text from your supplier PDF here...&#10;&#10;The AI will extract product codes, descriptions, categories, pipe sizes, and prices automatically."
                rows={8}
                className="text-xs font-mono"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" onClick={handleAIParse} disabled={aiParsing || !aiText.trim()}>
                {aiParsing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                {aiParsing ? "Parsing..." : "Parse with AI"}
              </Button>
            </div>
            {aiResult && (
              <div className="bg-success/10 text-success p-3 rounded-lg text-sm">
                ✅ {aiResult.imported} imported, {aiResult.updated} updated, {aiResult.skipped} skipped
              </div>
            )}
          </TabsContent>
        </Tabs>

        {importing && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Importing...</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplierProductImporter;

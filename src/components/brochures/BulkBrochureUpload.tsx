import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Loader2, Check, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getPageCount } from "@/lib/pdfMerger";

const BRANDS = ["Samsung", "Alliance", "Comfee"];
const CATEGORIES = [
  "Residential Wall-Mount",
  "Commercial Wall-Mount",
  "Commercial Cassette",
  "Commercial Ducted",
  "Commercial Underceiling",
];

interface ExistingBrochure {
  id: string;
  name: string;
  brand: string;
  model_match_prefixes: string[];
}

interface ParsedRow {
  fileName: string;
  filePath: string;
  pageCount: number;
  file: File;
  status: "uploading" | "parsing" | "ready" | "error" | "pending";
  errorMsg?: string;
  // AI-parsed fields (editable)
  brand: string;
  productName: string;
  category: string;
  prefixes: string[];
  // Match info
  matchedId: string | null;
  matchedName: string | null;
}

interface BulkBrochureUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingBrochures: ExistingBrochure[];
  onComplete: () => void;
}

function fuzzyMatch(
  parsed: { productName: string; prefixes: string[] },
  existing: ExistingBrochure[]
): { id: string; name: string } | null {
  // Check prefix overlap first
  for (const ex of existing) {
    const overlap = parsed.prefixes.some((p) =>
      ex.model_match_prefixes.some(
        (ep) =>
          p.toUpperCase().startsWith(ep.toUpperCase()) ||
          ep.toUpperCase().startsWith(p.toUpperCase())
      )
    );
    if (overlap) return { id: ex.id, name: ex.name };
  }
  // Check name similarity
  const normalName = parsed.productName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const ex of existing) {
    const exName = ex.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalName.includes(exName.slice(0, 15)) || exName.includes(normalName.slice(0, 15))) {
      return { id: ex.id, name: ex.name };
    }
  }
  return null;
}

// Process max N concurrent promises
async function pooledMap<T, R>(
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const BulkBrochureUpload = ({ open, onOpenChange, existingBrochures, onComplete }: BulkBrochureUploadProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [phase, setPhase] = useState<"select" | "processing" | "review" | "saving">("select");
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles(selected);
  };

  const startProcessing = useCallback(async () => {
    if (files.length === 0) return;
    setPhase("processing");
    setProgress(0);

    const initialRows: ParsedRow[] = files.map((f) => ({
      fileName: f.name,
      filePath: "",
      pageCount: 1,
      file: f,
      status: "uploading",
      brand: "Samsung",
      productName: f.name.replace(".pdf", ""),
      category: "",
      prefixes: [],
      matchedId: null,
      matchedName: null,
    }));
    setRows([...initialRows]);

    const totalSteps = files.length * 2; // upload + parse
    let completed = 0;

    const updateRow = (idx: number, updates: Partial<ParsedRow>) => {
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
    };

    // Phase 1: Upload all files to storage
    await pooledMap(
      files,
      async (file, idx) => {
        try {
          const filePath = `bulk/${Date.now()}_${idx}_${file.name}`;
          const { error } = await supabase.storage
            .from("product-brochures")
            .upload(filePath, file, { contentType: "application/pdf" });
          if (error) throw error;

          let pageCount = 1;
          try {
            const buf = await file.arrayBuffer();
            pageCount = await getPageCount(buf);
          } catch {}

          updateRow(idx, { filePath, pageCount, status: "parsing" });
          completed++;
          setProgress(Math.round((completed / totalSteps) * 100));
        } catch (err: any) {
          updateRow(idx, { status: "error", errorMsg: err.message });
          completed++;
          setProgress(Math.round((completed / totalSteps) * 100));
        }
      },
      5
    );

    // Phase 2: AI parse each uploaded file (max 5 concurrent)
    await pooledMap(
      initialRows,
      async (_, idx) => {
        // Re-read current state
        let currentRow: ParsedRow | undefined;
        setRows((prev) => {
          currentRow = prev[idx];
          return prev;
        });

        if (!currentRow || currentRow.status === "error" || !currentRow.filePath) {
          completed++;
          setProgress(Math.round((completed / totalSteps) * 100));
          return;
        }

        try {
          // Read file as base64
          const buf = await files[idx].arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), "")
          );

          const { data, error } = await supabase.functions.invoke("parse-brochure-pdf", {
            body: { pdfBase64: base64 },
          });

          if (error) throw new Error(error.message);

          const match = fuzzyMatch(
            { productName: data.product_name || "", prefixes: data.model_match_prefixes || [] },
            existingBrochures
          );

          const parsedPrefixes = data.model_match_prefixes || [];
          const parsedCategory = data.category || "Residential Wall-Mount";
          const parsedBrand = data.brand || "Samsung";
          const parsedName = data.product_name || files[idx].name.replace(".pdf", "");

          updateRow(idx, {
            status: parsedBrand && parsedName && parsedPrefixes.length > 0 ? "ready" : "ready",
            brand: parsedBrand,
            productName: parsedName,
            category: parsedCategory,
            prefixes: parsedPrefixes,
            matchedId: match?.id || null,
            matchedName: match?.name || null,
          });
        } catch (err: any) {
          console.warn("AI parse failed for", files[idx].name, err);
          updateRow(idx, {
            status: "ready",
            errorMsg: "AI parse failed - please fill manually",
          });
        }

        completed++;
        setProgress(Math.round((completed / totalSteps) * 100));
      },
      3
    );

    setPhase("review");
  }, [files, existingBrochures]);

  const updateRowField = (idx: number, field: keyof ParsedRow, value: any) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    let saved = 0;
    let errors = 0;

    for (const row of rows) {
      if (row.status === "error" || !row.filePath) continue;

      try {
        const record = {
          name: row.productName,
          brand: row.brand,
          category: row.category || null,
          file_url: row.filePath,
          file_name: row.fileName,
          model_match_prefixes: row.prefixes.map((p) => p.trim().toUpperCase()).filter(Boolean),
          page_count: row.pageCount,
          is_active: true,
        } as any;

        if (row.matchedId) {
          // Update existing
          const { error } = await supabase
            .from("product_brochures" as any)
            .update(record)
            .eq("id", row.matchedId);
          if (error) throw error;
        } else {
          // Insert new
          const { error } = await supabase
            .from("product_brochures" as any)
            .insert(record);
          if (error) throw error;
        }
        saved++;
      } catch (err: any) {
        console.error("Save failed:", row.fileName, err);
        errors++;
      }
    }

    setSaving(false);
    toast({
      title: "Bulk upload complete",
      description: `${saved} brochures saved${errors > 0 ? `, ${errors} failed` : ""}.`,
    });
    onComplete();
    onOpenChange(false);
    // Reset
    setFiles([]);
    setRows([]);
    setPhase("select");
    setProgress(0);
  };

  const readyCount = rows.filter((r) => r.status === "ready").length;
  const matchedCount = rows.filter((r) => r.matchedId).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setFiles([]);
          setRows([]);
          setPhase("select");
          setProgress(0);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Bulk Upload Brochures with AI
          </DialogTitle>
        </DialogHeader>

        {phase === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select multiple PDF brochures. AI will automatically detect brand, product name, category, and model prefixes.
            </p>
            <div>
              <Label>PDF Files</Label>
              <Input
                type="file"
                accept="application/pdf"
                multiple
                onChange={handleFilesSelected}
              />
            </div>
            {files.length > 0 && (
              <p className="text-sm">{files.length} file(s) selected</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={startProcessing} disabled={files.length === 0}>
                <Upload className="h-4 w-4 mr-1" /> Upload & Analyze
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "processing" && (
          <div className="space-y-4 py-8">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-sm font-medium">Uploading & analyzing with AI...</p>
              <p className="text-xs text-muted-foreground mt-1">
                {rows.filter((r) => r.status === "ready").length} / {rows.length} complete
              </p>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Badge variant="secondary">{readyCount} ready</Badge>
              {matchedCount > 0 && (
                <Badge variant="outline" className="border-amber-400 text-amber-600">
                  {matchedCount} matched to existing
                </Badge>
              )}
              {rows.filter((r) => r.status === "error").length > 0 && (
                <Badge variant="destructive">
                  {rows.filter((r) => r.status === "error").length} errors
                </Badge>
              )}
            </div>

            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">File</TableHead>
                    <TableHead className="w-[100px]">Brand</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead className="w-[160px]">Category</TableHead>
                    <TableHead>Model Prefixes</TableHead>
                    <TableHead className="w-[130px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow key={idx} className={row.status === "error" ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs font-mono truncate max-w-[140px]" title={row.fileName}>
                        {row.fileName}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.brand}
                          onValueChange={(v) => updateRowField(idx, "brand", v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BRANDS.map((b) => (
                              <SelectItem key={b} value={b}>
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={row.productName}
                          onChange={(e) => updateRowField(idx, "productName", e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.category || "none"}
                          onValueChange={(v) =>
                            updateRowField(idx, "category", v === "none" ? "" : v)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs font-mono"
                          value={row.prefixes.join(", ")}
                          onChange={(e) =>
                            updateRowField(
                              idx,
                              "prefixes",
                              e.target.value
                                .split(",")
                                .map((p) => p.trim().toUpperCase())
                                .filter(Boolean)
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {row.status === "error" ? (
                          <span className="flex items-center gap-1 text-destructive text-xs">
                            <AlertCircle className="h-3 w-3" /> Error
                          </span>
                        ) : row.matchedId ? (
                          <span className="text-xs text-amber-600" title={`Will update: ${row.matchedName}`}>
                            Matched: {row.matchedName?.slice(0, 20)}…
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <Check className="h-3 w-3" /> New
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSave} disabled={saving || readyCount === 0}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving...
                  </>
                ) : (
                  `Confirm & Save ${readyCount} Brochures`
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BulkBrochureUpload;

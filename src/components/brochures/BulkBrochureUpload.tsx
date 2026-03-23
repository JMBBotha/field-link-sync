import { useState, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Loader2, Check, AlertCircle, Sparkles, ExternalLink, Search } from "lucide-react";
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

interface SupplierProduct {
  id: string;
  product_code: string;
  short_name: string | null;
  brand: string | null;
}

interface ParsedRow {
  fileName: string;
  filePath: string;
  pageCount: number;
  file: File;
  status: "uploading" | "parsing" | "ready" | "error" | "pending";
  errorMsg?: string;
  brand: string;
  productName: string;
  category: string;
  candidateSnippets: string[];
  linkedProductIds: string[];
  matchedId: string | null;
  matchedName: string | null;
  productSearchQuery: string;
}

interface BulkBrochureUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingBrochures: ExistingBrochure[];
  onComplete: () => void;
}

/** Derive prefixes from product codes - first 4-6 significant chars */
function derivePrefixes(productCodes: string[]): string[] {
  const prefixes = new Set<string>();
  for (const code of productCodes) {
    const upper = code.toUpperCase().trim();
    if (!upper) continue;
    // Try to get a meaningful prefix: letters + first digits
    const match = upper.match(/^([A-Z]{1,4}\d{2,4}[A-Z]?)/);
    if (match) {
      prefixes.add(match[1]);
    } else {
      // Fallback: first 5 chars
      prefixes.add(upper.slice(0, 5));
    }
  }
  return Array.from(prefixes).sort();
}

function fuzzyMatch(
  parsed: { productName: string; candidateSnippets: string[] },
  existing: ExistingBrochure[]
): { id: string; name: string } | null {
  for (const ex of existing) {
    const overlap = parsed.candidateSnippets.some((s) =>
      ex.model_match_prefixes.some(
        (ep) =>
          s.toUpperCase().startsWith(ep.toUpperCase()) ||
          ep.toUpperCase().startsWith(s.toUpperCase())
      )
    );
    if (overlap) return { id: ex.id, name: ex.name };
  }
  return null;
}

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

/** Check if a product_code matches any of the AI candidate snippets (fuzzy 6-8 char) */
function productMatchesSnippets(productCode: string, snippets: string[]): boolean {
  const upper = productCode.toUpperCase().trim();
  if (!upper || snippets.length === 0) return false;
  const code8 = upper.slice(0, 8);
  return snippets.some((s) => {
    const su = s.toUpperCase().trim();
    if (!su) return false;
    // Direct contains in either direction
    if (upper.includes(su) || su.includes(code8)) return true;
    // Fuzzy: first 6 chars of snippet matches anywhere in code or vice-versa
    const snip6 = su.slice(0, 6);
    if (snip6.length >= 4 && upper.includes(snip6)) return true;
    if (code8.length >= 4 && su.includes(code8.slice(0, 6))) return true;
    return false;
  });
}

const BulkBrochureUpload = ({ open, onOpenChange, existingBrochures, onComplete }: BulkBrochureUploadProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [phase, setPhase] = useState<"select" | "processing" | "review" | "saving">("select");
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [allProducts, setAllProducts] = useState<SupplierProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  // Load all supplier products on open
  useEffect(() => {
    if (!open) return;
    setProductsLoading(true);
    (async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand")
        .or("archived.is.null,archived.eq.false")
        .order("product_code")
        .limit(2000);
      if (!error && data) {
        setAllProducts(data as SupplierProduct[]);
      }
      setProductsLoading(false);
    })();
  }, [open]);

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
      status: "uploading" as const,
      brand: "Samsung",
      productName: f.name.replace(".pdf", ""),
      category: "",
      candidateSnippets: [],
      linkedProductIds: [],
      matchedId: null,
      matchedName: null,
      productSearchQuery: "",
    }));
    setRows([...initialRows]);

    const totalSteps = files.length * 2;
    let completed = 0;

    const updateRow = (idx: number, updates: Partial<ParsedRow>) => {
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
    };

    // Phase 1: Upload all files
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

    // Phase 2: AI parse (max 3 concurrent)
    await pooledMap(
      initialRows,
      async (_, idx) => {
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
          const buf = await files[idx].arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), "")
          );

          const { data, error } = await supabase.functions.invoke("parse-brochure-pdf", {
            body: { pdfBase64: base64 },
          });

          if (error) throw new Error(error.message);

          const snippets: string[] = (data.candidate_model_snippets || []).map((p: string) => p.trim().toUpperCase()).filter(Boolean);
          const parsedCategory = data.category || "Residential Wall-Mount";
          const parsedBrand = data.brand || "Samsung";
          const parsedName = data.product_name || files[idx].name.replace(".pdf", "");

          // Auto-link products whose product_code matches any snippet
          const autoLinked = allProducts
            .filter((p) => {
              if (parsedBrand && p.brand && p.brand.toLowerCase() !== parsedBrand.toLowerCase()) return false;
              return productMatchesSnippets(p.product_code, snippets);
            })
            .map((p) => p.id);

          const match = fuzzyMatch(
            { productName: parsedName, candidateSnippets: snippets },
            existingBrochures
          );

          updateRow(idx, {
            status: "ready",
            brand: parsedBrand,
            productName: parsedName,
            category: parsedCategory,
            candidateSnippets: snippets,
            linkedProductIds: autoLinked,
            matchedId: match?.id || null,
            matchedName: match?.name || null,
          });
        } catch (err: any) {
          console.warn("AI parse failed for", files[idx].name, err);
          updateRow(idx, {
            status: "ready",
            category: "Residential Wall-Mount",
            candidateSnippets: [],
            errorMsg: "AI parse failed - please link products manually",
          });
        }

        completed++;
        setProgress(Math.round((completed / totalSteps) * 100));
      },
      3
    );

    setPhase("review");
  }, [files, existingBrochures, allProducts]);

  const updateRowField = (idx: number, field: keyof ParsedRow, value: any) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const toggleProduct = (rowIdx: number, productId: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        const has = r.linkedProductIds.includes(productId);
        return {
          ...r,
          linkedProductIds: has
            ? r.linkedProductIds.filter((id) => id !== productId)
            : [...r.linkedProductIds, productId],
        };
      })
    );
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    let saved = 0;
    let errors = 0;

    for (const row of rows) {
      if (row.status === "error" || !row.filePath) continue;
      if (!row.brand || !row.productName) continue;

      try {
        // Derive prefixes from linked products
        const linkedCodes = allProducts
          .filter((p) => row.linkedProductIds.includes(p.id))
          .map((p) => p.product_code);
        const derivedPrefixes = derivePrefixes(linkedCodes);

        const record = {
          name: row.productName,
          brand: row.brand,
          category: row.category || null,
          file_url: row.filePath,
          file_name: row.fileName,
          model_match_prefixes: derivedPrefixes,
          linked_product_ids: row.linkedProductIds,
          page_count: row.pageCount,
          is_active: true,
        } as any;

        if (row.matchedId) {
          const { error } = await supabase
            .from("product_brochures" as any)
            .update(record)
            .eq("id", row.matchedId);
          if (error) throw error;
        } else {
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
    setFiles([]);
    setRows([]);
    setPhase("select");
    setProgress(0);
  };

  const readyCount = rows.filter((r) => r.status === "ready" && r.brand && r.productName).length;
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
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Bulk Upload Brochures with AI
          </DialogTitle>
        </DialogHeader>

        {phase === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select multiple PDF brochures. AI will detect brand, product name, and model codes, then auto-link to real products in your catalog.
            </p>
            <div>
              <Label>PDF Files</Label>
              <Input type="file" accept="application/pdf" multiple onChange={handleFilesSelected} />
            </div>
            {files.length > 0 && <p className="text-sm">{files.length} file(s) selected</p>}
            {productsLoading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading product catalog...
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={startProcessing} disabled={files.length === 0 || productsLoading}>
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
                    <TableHead className="w-[120px]">PDF</TableHead>
                    <TableHead className="w-[90px]">Brand</TableHead>
                    <TableHead className="w-[150px]">Product Name</TableHead>
                    <TableHead className="w-[140px]">Category</TableHead>
                    <TableHead className="w-[260px]">Linked Products</TableHead>
                    <TableHead className="w-[120px]">Derived Prefixes</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <BulkUploadRow
                      key={idx}
                      row={row}
                      idx={idx}
                      allProducts={allProducts}
                      updateRowField={updateRowField}
                      toggleProduct={toggleProduct}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleConfirmSave} disabled={saving || readyCount === 0}>
                {saving ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving...</>
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

/** Individual row component to keep the table manageable */
function BulkUploadRow({
  row,
  idx,
  allProducts,
  updateRowField,
  toggleProduct,
}: {
  row: ParsedRow;
  idx: number;
  allProducts: SupplierProduct[];
  updateRowField: (idx: number, field: keyof ParsedRow, value: any) => void;
  toggleProduct: (rowIdx: number, productId: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter products by brand + search
  const filteredProducts = useMemo(() => {
    return allProducts.filter((p) => {
      // Filter by brand
      if (row.brand && p.brand && p.brand.toLowerCase() !== row.brand.toLowerCase()) return false;
      // Filter by search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.product_code.toLowerCase().includes(q) ||
          (p.short_name || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allProducts, row.brand, searchQuery]);

  // Sort: linked first, then AI-matched, then rest
  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const aLinked = row.linkedProductIds.includes(a.id) ? 0 : 1;
      const bLinked = row.linkedProductIds.includes(b.id) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      const aMatch = productMatchesSnippets(a.product_code, row.candidateSnippets) ? 0 : 1;
      const bMatch = productMatchesSnippets(b.product_code, row.candidateSnippets) ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [filteredProducts, row.linkedProductIds, row.candidateSnippets]);

  // Derive prefixes from currently linked products
  const derivedPrefixes = useMemo(() => {
    const linkedCodes = allProducts
      .filter((p) => row.linkedProductIds.includes(p.id))
      .map((p) => p.product_code);
    return derivePrefixes(linkedCodes);
  }, [allProducts, row.linkedProductIds]);

  // PDF public URL
  const pdfUrl = row.filePath
    ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/product-brochures/${row.filePath}`
    : null;

  return (
    <TableRow className={row.status === "error" ? "bg-destructive/5" : ""}>
      {/* PDF link */}
      <TableCell className="text-xs">
        {pdfUrl ? (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline truncate max-w-[110px]"
            title={row.fileName}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{row.fileName.slice(0, 14)}</span>
          </a>
        ) : (
          <span className="text-muted-foreground truncate">{row.fileName.slice(0, 14)}</span>
        )}
      </TableCell>

      {/* Brand */}
      <TableCell>
        <Select value={row.brand} onValueChange={(v) => updateRowField(idx, "brand", v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BRANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Product Name */}
      <TableCell>
        <Input
          className="h-8 text-xs"
          value={row.productName}
          onChange={(e) => updateRowField(idx, "productName", e.target.value)}
        />
      </TableCell>

      {/* Category */}
      <TableCell>
        <Select
          value={row.category || "none"}
          onValueChange={(v) => updateRowField(idx, "category", v === "none" ? "" : v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Linked Products */}
      <TableCell>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <Input
              className="h-6 text-[10px] font-mono flex-1"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Badge variant="secondary" className="text-[9px] shrink-0">
              {row.linkedProductIds.length}
            </Badge>
          </div>
          <ScrollArea className="h-[120px] border rounded-md p-1">
            {sortedProducts.slice(0, 50).map((p) => {
              const isLinked = row.linkedProductIds.includes(p.id);
              const isAiSuggested = productMatchesSnippets(p.product_code, row.candidateSnippets);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-1.5 px-1 py-0.5 rounded text-[10px] cursor-pointer hover:bg-muted/50 ${
                    isLinked ? "bg-primary/5" : ""
                  }`}
                >
                  <Checkbox
                    checked={isLinked}
                    onCheckedChange={() => toggleProduct(idx, p.id)}
                    className="h-3 w-3"
                  />
                  <span className="font-mono font-medium truncate">{p.product_code}</span>
                  <span className="text-muted-foreground truncate flex-1">{p.short_name || ""}</span>
                  {isAiSuggested && !isLinked && (
                    <Badge variant="outline" className="text-[7px] px-1 py-0 border-amber-300 text-amber-600">AI</Badge>
                  )}
                </label>
              );
            })}
            {sortedProducts.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-3">
                No products match this brand
              </p>
            )}
          </ScrollArea>
        </div>
      </TableCell>

      {/* Derived Prefixes */}
      <TableCell>
        <div className="flex flex-wrap gap-0.5">
          {derivedPrefixes.length > 0 ? (
            derivedPrefixes.map((p) => (
              <Badge key={p} variant="outline" className="text-[8px] font-mono">
                {p}
              </Badge>
            ))
          ) : (
            <span className="text-[9px] text-muted-foreground">Link products →</span>
          )}
        </div>
      </TableCell>

      {/* Status */}
      <TableCell>
        {row.status === "error" ? (
          <span className="flex items-center gap-1 text-destructive text-xs">
            <AlertCircle className="h-3 w-3" /> Error
          </span>
        ) : row.matchedId ? (
          <span className="text-xs text-amber-600" title={`Will update: ${row.matchedName}`}>
            Update: {row.matchedName?.slice(0, 14)}…
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" /> New
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

export default BulkBrochureUpload;

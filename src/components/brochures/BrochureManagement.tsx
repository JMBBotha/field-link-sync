import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Upload, FileText, X, Trash2, Sparkles, Download, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import BulkBrochureUpload from "./BulkBrochureUpload";
import { getPageCount } from "@/lib/pdfMerger";

interface Brochure {
  id: string;
  name: string;
  brand: string;
  category: string | null;
  file_url: string;
  file_name: string;
  model_match_prefixes: string[];
  page_count: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

const BRANDS = ["Samsung", "Alliance", "Comfee"];
const CATEGORIES = [
  "Residential Wall-Mount",
  "Commercial Wall-Mount",
  "Commercial Cassette",
  "Commercial Ducted",
  "Commercial Underceiling",
];

const brandColor: Record<string, string> = {
  Samsung: "bg-blue-100 text-blue-700 border-blue-300",
  Alliance: "bg-green-100 text-green-700 border-green-300",
  Comfee: "bg-orange-100 text-orange-700 border-orange-300",
};

const renderPdfToImages = async (arrayBuffer: ArrayBuffer): Promise<string[]> => {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const pdf = await pdfjsLib
    .getDocument({
      data: arrayBuffer,
      cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    })
    .promise;

  const images: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.35 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/png"));
  }

  return images;
};

const BrochureManagement = () => {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<{
    url: string;
    name: string;
    blobUrl?: string;
    pageImages?: string[];
    loading?: boolean;
    error?: string;
  } | null>(null);
  
  const [formName, setFormName] = useState("");
  const [formBrand, setFormBrand] = useState("Samsung");
  const [formCategory, setFormCategory] = useState("");
  const [formPrefixes, setFormPrefixes] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: brochures = [], isLoading } = useQuery({
    queryKey: ["product-brochures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_brochures" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Brochure[];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("product_brochures" as any)
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-brochures"] }),
  });

  const deleteBrochure = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_brochures" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-brochures"] });
      toast({ title: "Deleted", description: "Brochure removed." });
    },
  });

  const handleUpload = useCallback(async () => {
    if (!formFile || !formName || !formBrand) {
      toast({ title: "Missing fields", description: "Name, brand and file are required.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const filePath = `${Date.now()}_${formFile.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("product-brochures")
        .upload(filePath, formFile, { contentType: "application/pdf" });
      if (uploadErr) throw uploadErr;

      // Extract page count
      const arrayBuf = await formFile.arrayBuffer();
      let pageCount = 1;
      try {
        pageCount = await getPageCount(arrayBuf);
      } catch {}

      const prefixArr = formPrefixes
        .split(",")
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean);

      const { error: insertErr } = await supabase.from("product_brochures" as any).insert({
        name: formName,
        brand: formBrand,
        category: formCategory || null,
        file_url: filePath,
        file_name: formFile.name,
        model_match_prefixes: prefixArr,
        page_count: pageCount,
      } as any);
      if (insertErr) throw insertErr;

      queryClient.invalidateQueries({ queryKey: ["product-brochures"] });
      toast({ title: "Uploaded", description: `${formName} added with ${pageCount} pages.` });
      setShowDialog(false);
      setFormName("");
      setFormBrand("Samsung");
      setFormCategory("");
      setFormPrefixes("");
      setFormFile(null);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [formFile, formName, formBrand, formCategory, formPrefixes, queryClient]);

  const getPublicUrl = (path: string) => {
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("product-brochures").getPublicUrl(path);
    return data.publicUrl;
  };

  const closePreview = useCallback(() => {
    setPreviewPdf((prev) => {
      if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
      return null;
    });
  }, []);

  const openPreview = useCallback(async (brochure: Brochure) => {
    const url = getPublicUrl(brochure.file_url);

    setPreviewPdf((prev) => {
      if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
      return { url, name: brochure.name, loading: true };
    });

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to load PDF");

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreviewPdf({ url, name: brochure.name, blobUrl, loading: false });
    } catch {
      setPreviewPdf({
        url,
        name: brochure.name,
        loading: false,
        error: "Inline preview is unavailable. Use New tab or Download.",
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (previewPdf?.blobUrl) URL.revokeObjectURL(previewPdf.blobUrl);
    };
  }, [previewPdf?.blobUrl]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage PDF brochures that auto-attach to quotes based on model code matching.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowBulkDialog(true)} size="sm">
            <Sparkles className="h-4 w-4 mr-1" /> Bulk Upload (AI)
          </Button>
          <Button onClick={() => setShowDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Upload Brochure
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : brochures.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>No brochures uploaded yet.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {brochures.map((b) => (
            <Card key={b.id} className={!b.is_active ? "opacity-50" : ""}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{b.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="outline" className={`text-[10px] ${brandColor[b.brand] || ""}`}>
                        {b.brand}
                      </Badge>
                      {b.category && (
                        <Badge variant="secondary" className="text-[10px]">
                          {b.category}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">{b.page_count}p</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Switch
                      checked={b.is_active}
                      onCheckedChange={(v) => toggleActive.mutate({ id: b.id, is_active: v })}
                      className="scale-75"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteBrochure.mutate(b.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {b.model_match_prefixes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {b.model_match_prefixes.map((prefix, i) => (
                      <Badge key={i} variant="outline" className="text-[9px] font-mono">
                        {prefix}
                      </Badge>
                    ))}
                  </div>
                )}
                {b.file_url && !b.file_url.startsWith("placeholder") ? (
                  <button
                    onClick={() => openPreview(b)}
                    className="text-xs text-primary hover:underline"
                  >
                    View PDF →
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground italic">No PDF uploaded</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Product Brochure</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Samsung AR9500 WindFree" />
            </div>
            <div>
              <Label>Brand *</Label>
              <Select value={formBrand} onValueChange={setFormBrand}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BRANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PDF File *</Label>
              <Input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFormFile(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <Label>Model Match Prefixes</Label>
              <Input
                value={formPrefixes}
                onChange={(e) => setFormPrefixes(e.target.value)}
                placeholder="AR12BSAA, AR18BSAA, AR24BSAA"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Enter model code starts, comma-separated. E.g. "AR80F" matches AR80F12CADW/FA
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF Preview Dialog */}
      <Dialog
        open={!!previewPdf}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <DialogTitle className="text-sm font-semibold truncate max-w-[42%]">
              {previewPdf?.name}
            </DialogTitle>
            <div className="flex items-center gap-2 mr-8">
              <a
                href={previewPdf?.url}
                download
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
              <a
                href={previewPdf?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" /> New tab
              </a>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closePreview}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 p-2">
            {previewPdf?.loading ? (
              <div className="h-[80vh] w-full grid place-items-center text-sm text-muted-foreground">Loading PDF...</div>
            ) : previewPdf ? (
              <object
                data={previewPdf.blobUrl || previewPdf.url}
                type="application/pdf"
                className="w-full h-[80vh] rounded"
              >
                <p className="text-center py-8 text-muted-foreground">
                  {previewPdf.error || "PDF cannot be displayed."}{" "}
                  <a href={previewPdf.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Open directly
                  </a>
                </p>
              </object>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <BulkBrochureUpload
        open={showBulkDialog}
        onOpenChange={setShowBulkDialog}
        existingBrochures={brochures.map((b) => ({
          id: b.id,
          name: b.name,
          brand: b.brand,
          model_match_prefixes: b.model_match_prefixes,
        }))}
        onComplete={() => queryClient.invalidateQueries({ queryKey: ["product-brochures"] })}
      />
    </div>
  );
};

export default BrochureManagement;

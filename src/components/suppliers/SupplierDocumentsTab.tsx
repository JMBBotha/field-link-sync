import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Trash2, Loader2, Eye } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PDFExtractReviewModal from "./PDFExtractReviewModal";

interface SupplierDocument {
  id: string;
  supplier_id: string;
  file_name: string;
  storage_path: string;
  file_type: string | null;
  created_at: string;
}

interface SupplierDocumentsTabProps {
  supplierId: string;
}

const SupplierDocumentsTab = ({ supplierId }: SupplierDocumentsTabProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<Record<string, string> | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["supplier-documents", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_documents") as any)
        .select("*")
        .eq("supplier_id", supplierId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SupplierDocument[];
    },
  });

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    const maxPages = Math.min(pdf.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(" ") + "\n";
    }
    return text;
  };

  const parseExtractedInfo = (text: string): Record<string, string> => {
    const result: Record<string, string> = {};

    // Phone numbers (SA format)
    const phoneMatch = text.match(/(?:\+27|0)\s*\d{2}\s*\d{3}\s*\d{4}/g);
    if (phoneMatch) result.phone = phoneMatch[0].replace(/\s/g, "");

    // Email addresses
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatch) {
      result.email = emailMatch[0];
      // Try to categorize
      const categorized: Record<string, string> = {};
      emailMatch.forEach((em) => {
        const lower = em.toLowerCase();
        if (lower.startsWith("sales")) categorized["Sales"] = em;
        else if (lower.startsWith("accounts") || lower.startsWith("finance")) categorized["Accounts"] = em;
        else if (lower.startsWith("info")) categorized["General"] = em;
        else if (lower.startsWith("tech") || lower.startsWith("support")) categorized["Technical"] = em;
        else if (!categorized["General"]) categorized["General"] = em;
      });
      if (Object.keys(categorized).length > 0) {
        result.categorized_emails = JSON.stringify(categorized);
      }
    }

    // VAT number
    const vatMatch = text.match(/(?:VAT|vat)\s*(?:No\.?|Number|#)?\s*:?\s*(\d{10})/i);
    if (vatMatch) result.vat_number = vatMatch[1];

    // Registration number
    const regMatch = text.match(/(?:Reg|Registration|CK)\s*(?:No\.?|Number|#)?\s*:?\s*([\d/]+)/i);
    if (regMatch) result.registration_number = regMatch[1];

    // Website
    const webMatch = text.match(/(?:www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi);
    if (webMatch) result.website = webMatch[0];

    // Physical address (simple heuristic: look for patterns with street numbers)
    const addressMatch = text.match(/\d+\s+[A-Z][a-zA-Z]+\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Blvd|Boulevard)[^,\n]*/);
    if (addressMatch) result.physical_address = addressMatch[0].trim();

    return result;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const path = `${supplierId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("supplier-documents")
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { error: dbError } = await (supabase.from("supplier_documents") as any).insert({
        supplier_id: supplierId,
        file_name: file.name,
        storage_path: path,
        file_type: file.type,
      });
      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: ["supplier-documents", supplierId] });
      toast({ title: "Document uploaded" });

      // If PDF, extract info
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        try {
          const text = await extractTextFromPDF(file);
          const info = parseExtractedInfo(text);
          if (Object.keys(info).length > 0) {
            setExtractedData(info);
          } else {
            toast({ title: "No extractable data found in PDF", description: "The PDF didn't contain recognizable supplier information." });
          }
        } catch (parseErr) {
          console.warn("PDF parse failed:", parseErr);
        }
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (doc: SupplierDocument) => {
      await supabase.storage.from("supplier-documents").remove([doc.storage_path]);
      const { error } = await (supabase.from("supplier_documents") as any).delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-documents", supplierId] });
      toast({ title: "Document deleted" });
      setDeleteId(null);
    },
  });

  const deleteDoc = documents.find((d) => d.id === deleteId);

  return (
    <div className="space-y-3 mt-2">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{documents.length} document{documents.length !== 1 ? "s" : ""}</p>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            className="hidden"
            onChange={handleUpload}
          />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
            Upload PDF
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id} className="group">
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setDeleteId(doc.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* PDF Extract Review Modal */}
      {extractedData && (
        <PDFExtractReviewModal
          open={!!extractedData}
          onOpenChange={(o) => !o && setExtractedData(null)}
          extractedData={extractedData}
          supplierId={supplierId}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteDoc?.file_name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDoc && deleteMutation.mutate(deleteDoc)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SupplierDocumentsTab;

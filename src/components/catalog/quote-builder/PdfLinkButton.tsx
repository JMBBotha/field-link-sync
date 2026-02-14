import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Link2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface PdfLinkButtonProps {
  /** All page records for the current supplier + filename group */
  pages: { id: string; supplier_id: string; pdf_filename: string }[];
}

const PdfLinkButton = ({ pages }: PdfLinkButtonProps) => {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFile = useCallback(async (file: File) => {
    if (!file || pages.length === 0) return;
    setUploading(true);
    try {
      const supplierId = pages[0].supplier_id;
      const storagePath = `${supplierId}/${file.name}`;

      // Upload to storage
      const { error: uploadErr } = await supabase.storage
        .from("supplier-pdfs")
        .upload(storagePath, file, { upsert: true, contentType: "application/pdf" });

      if (uploadErr) {
        // Try creating the bucket if it doesn't exist
        if (uploadErr.message?.includes("not found") || uploadErr.message?.includes("Bucket")) {
          console.warn("[PdfLink] Bucket may not exist, trying public URL approach");
        }
        throw uploadErr;
      }

      const { data: urlData } = supabase.storage.from("supplier-pdfs").getPublicUrl(storagePath);
      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) throw new Error("Failed to get public URL");

      // Update all page records for this PDF with the storage path
      const pageIds = pages.map((p) => p.id);
      const { error: updateErr } = await (supabase.from("supplier_pdf_pages") as any)
        .update({ pdf_storage_path: publicUrl })
        .in("id", pageIds);

      if (updateErr) throw updateErr;

      toast({ title: "PDF linked successfully", description: "Interactive overlays are now available." });
      queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
      queryClient.invalidateQueries({ queryKey: ["visual-panel-live-extract"] });
    } catch (err: any) {
      console.error("[PdfLink] Upload failed:", err);
      toast({ title: "Link failed", description: err.message || "Could not upload PDF", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [pages, queryClient]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] gap-1 shrink-0"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
        {uploading ? "Linking…" : "Link PDF"}
      </Button>
    </>
  );
};

export default PdfLinkButton;

import { useEffect, useState } from "react";
import PhotoDeleteButton from "@/components/photos/PhotoDeleteButton";
import { deleteQuotePhoto } from "@/lib/photoDelete";
import { useRole } from "@/hooks/useRole";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import browserImageCompression from "browser-image-compression";
import { quotePhotoFolder, signedQuotePhotoUrl } from "@/lib/quotePhotos";

interface Attachment {
  id?: string;
  storage_path: string;
  filename: string;
  caption: string;
  url: string;
}

interface PhotoUploaderProps {
  quoteId: string | null;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
}

const PhotoUploader = ({ quoteId, attachments, onAttachmentsChange }: PhotoUploaderProps) => {
  const { canDelete } = useRole();
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !quoteId) return;
    setUploading(true);

    try {
      const newAttachments: Attachment[] = [];
      const companyId = await quotePhotoFolder();
      for (const file of Array.from(e.target.files)) {
        const compressed = await browserImageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
        const path = `${companyId}/${quoteId}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("quote-photos")
          .upload(path, compressed);
        if (uploadError) throw uploadError;

        const signedUrl = await signedQuotePhotoUrl(path);

        const { error: dbError } = await supabase
          .from("quote_attachments")
          .insert({ quote_id: quoteId, storage_path: path, filename: file.name, caption: "" });
        if (dbError) throw dbError;

        newAttachments.push({
          storage_path: path,
          filename: file.name,
          caption: "",
          url: signedUrl,
        });
      }
      onAttachmentsChange([...attachments, ...newAttachments]);
      toast({ title: "Photos uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemove = async (index: number) => {
    const att = attachments[index];
    await deleteQuotePhoto(att.storage_path);
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
    toast({ title: "Photo deleted" });
  };
  // Same rule as RLS (photo_quote_ok): office any quote in the company, reps only their own.
  const [quoteOk, setQuoteOk] = useState(false);
  useEffect(() => {
    let live = true;
    if (!quoteId) { setQuoteOk(false); return; }
    (supabase.rpc as any)("photo_quote_ok", { _quote: quoteId }).then(({ data }: any) => { if (live) setQuoteOk(data === true); });
    return () => { live = false; };
  }, [quoteId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={uploading || !quoteId} asChild>
          <label className="cursor-pointer">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Camera className="h-4 w-4 mr-1" />}
            {uploading ? "Uploading..." : "Add Photos"}
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
          </label>
        </Button>
        {!quoteId && <span className="text-xs text-muted-foreground">Save quote first to upload photos</span>}
      </div>

      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((att, i) => (
            <div key={i} className="relative group rounded-md overflow-hidden border">
              <img src={att.url} alt={att.filename} className="w-full h-24 object-cover" />
              {(canDelete || quoteOk) && <PhotoDeleteButton variant="thumb" className="absolute top-1 right-1" onConfirm={() => handleRemove(i)} testId="quote-photo-delete" />}
              <p className="text-xs truncate px-1 py-0.5 bg-background/80">{att.filename}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhotoUploader;

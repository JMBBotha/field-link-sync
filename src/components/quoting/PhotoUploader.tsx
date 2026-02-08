import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import browserImageCompression from "browser-image-compression";

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
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !quoteId) return;
    setUploading(true);

    try {
      const newAttachments: Attachment[] = [];
      for (const file of Array.from(e.target.files)) {
        const compressed = await browserImageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
        const path = `${quoteId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("quote-photos")
          .upload(path, compressed);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("quote-photos")
          .getPublicUrl(path);

        const { error: dbError } = await supabase
          .from("quote_attachments")
          .insert({ quote_id: quoteId, storage_path: path, filename: file.name, caption: "" });
        if (dbError) throw dbError;

        newAttachments.push({
          storage_path: path,
          filename: file.name,
          caption: "",
          url: urlData.publicUrl,
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
    await supabase.storage.from("quote-photos").remove([att.storage_path]);
    await supabase.from("quote_attachments").delete().eq("storage_path", att.storage_path);
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
  };

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
              <img src={att.url} alt={att.filename} className="w-full h-20 object-cover" />
              <button
                onClick={() => handleRemove(i)}
                className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              <p className="text-[10px] truncate px-1 py-0.5 bg-background/80">{att.filename}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhotoUploader;

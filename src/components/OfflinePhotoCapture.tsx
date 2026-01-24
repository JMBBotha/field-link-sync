import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Camera, 
  X, 
  Upload, 
  CloudOff, 
  Check,
  Trash2,
  ImagePlus,
  Loader2
} from "lucide-react";
import { offlineDb, OfflinePhoto } from "@/lib/offlineDb";
import { useToast } from "@/hooks/use-toast";

interface OfflinePhotoCaptureProps {
  leadId: string;
  agentId: string;
  isOnline: boolean;
  onPhotoQueued: () => void;
  queueOperation: (type: string, table: string, id: string, data: any) => Promise<void>;
}

export function OfflinePhotoCapture({
  leadId,
  agentId,
  isOnline,
  onPhotoQueued,
  queueOperation,
}: OfflinePhotoCaptureProps) {
  const [photos, setPhotos] = useState<OfflinePhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Load photos for this lead
  const loadPhotos = useCallback(async () => {
    try {
      const leadPhotos = await offlineDb.getPhotosForLead(leadId);
      setPhotos(leadPhotos);
    } catch (error) {
      console.error("Failed to load photos:", error);
    }
  }, [leadId]);

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast({
            title: "Invalid File",
            description: "Please select an image file",
            variant: "destructive",
          });
          continue;
        }

        // Convert to base64
        const base64Data = await fileToBase64(file);
        
        // Create photo record
        const photoId = crypto.randomUUID();
        const photo: Omit<OfflinePhoto, 'uploaded'> = {
          id: photoId,
          leadId,
          base64Data,
          fileName: file.name,
          mimeType: file.type,
          caption: caption || null,
          photoType: 'after', // Default to after
          capturedAt: Date.now(),
        };

        // Save to IndexedDB
        await offlineDb.savePhoto(photo);

        // Queue for upload
        await queueOperation(
          'upload_photo',
          'job_photos',
          agentId,
          {
            photoId,
            leadId,
            base64Data,
            fileName: file.name,
            mimeType: file.type,
            caption: caption || null,
          }
        );

        onPhotoQueued();
      }

      // Reload photos
      await loadPhotos();
      setCaption("");
      
      toast({
        title: isOnline ? "Photo Uploading" : "Photo Saved Offline",
        description: isOnline 
          ? "Your photo is being uploaded"
          : "Photo will sync when you're back online",
      });
    } catch (error) {
      console.error("Failed to save photo:", error);
      toast({
        title: "Error",
        description: "Failed to save photo",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  // Delete a photo
  const handleDeletePhoto = async (photoId: string) => {
    try {
      await offlineDb.deletePhoto(photoId);
      await loadPhotos();
      toast({
        title: "Photo Removed",
        description: "The photo has been removed",
      });
    } catch (error) {
      console.error("Failed to delete photo:", error);
    }
  };

  // Open panel and load photos
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      loadPhotos();
    }
  };

  const pendingCount = photos.filter(p => !p.uploaded).length;
  const uploadedCount = photos.filter(p => p.uploaded).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Camera className="h-4 w-4" />
          Photos
          {pendingCount > 0 && (
            <Badge variant="secondary" className="ml-1 bg-orange-500/20 text-orange-500">
              {pendingCount} pending
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Job Photos
          </DialogTitle>
          <DialogDescription>
            Capture and upload photos for this job
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              {uploadedCount > 0 && (
                <span className="flex items-center gap-1 text-green-600">
                  <Check className="h-4 w-4" />
                  {uploadedCount} uploaded
                </span>
              )}
              {pendingCount > 0 && (
                <span className="flex items-center gap-1 text-orange-500">
                  <CloudOff className="h-4 w-4" />
                  {pendingCount} pending
                </span>
              )}
            </div>
            {!isOnline && (
              <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/30">
                Offline Mode
              </Badge>
            )}
          </div>

          {/* Caption Input */}
          <div className="space-y-2">
            <Label htmlFor="caption">Caption (optional)</Label>
            <Input
              id="caption"
              placeholder="Add a description..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>

          {/* File Input */}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
              multiple
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="flex-1 gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              Take Photo
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute('capture');
                  fileInputRef.current.click();
                  fileInputRef.current.setAttribute('capture', 'environment');
                }
              }}
              disabled={loading}
              className="gap-2"
            >
              <ImagePlus className="h-4 w-4" />
              Gallery
            </Button>
          </div>

          {/* Photo Grid */}
          {photos.length > 0 && (
            <ScrollArea className="h-[250px]">
              <div className="grid grid-cols-2 gap-2">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="relative group rounded-lg overflow-hidden border bg-muted aspect-square"
                  >
                    <img
                      src={photo.base64Data}
                      alt={photo.caption || "Job photo"}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedImage(photo.base64Data)}
                    />
                    
                    {/* Status Badge */}
                    <div className="absolute top-1 left-1">
                      {photo.uploaded ? (
                        <Badge className="bg-green-500/90 text-white text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Uploaded
                        </Badge>
                      ) : (
                        <Badge className="bg-orange-500/90 text-white text-xs">
                          <Upload className="h-3 w-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </div>

                    {/* Delete Button */}
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePhoto(photo.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>

                    {/* Caption */}
                    {photo.caption && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">
                        {photo.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {photos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Camera className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">No photos yet</p>
              <p className="text-xs">Tap "Take Photo" to get started</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Full-size Image Preview */}
      {selectedImage && (
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-3xl p-0">
            <div className="relative">
              <img
                src={selectedImage}
                alt="Full size preview"
                className="w-full h-auto max-h-[80vh] object-contain"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
                onClick={() => setSelectedImage(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

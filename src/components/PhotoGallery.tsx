import { useState, useEffect, useCallback } from 'react';
import { X, Cloud, Clock } from 'lucide-react';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SwipeablePhoto } from './SwipeablePhoto';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PhotoItem {
  id: string;
  url: string;
  caption?: string | null;
  photoType: 'before' | 'after';
  isQueued: boolean;
  storagePath?: string;
  markedForDeletion?: boolean;
}

interface PhotoGalleryProps {
  leadId: string;
  isOnline: boolean;
  onDeletePhoto?: (photoId: string, storagePath?: string) => Promise<void>;
  deleting?: boolean;
  refreshKey?: number;
}

export function PhotoGallery({ 
  leadId, 
  isOnline, 
  onDeletePhoto,
  deleting,
  refreshKey = 0,
}: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<PhotoItem | null>(null);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const items: PhotoItem[] = [];

      // Load uploaded photos from Supabase
      if (isOnline) {
        const { data: dbPhotos } = await supabase
          .from('job_photos')
          .select('id, storage_path, caption, photo_type')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false });

        if (dbPhotos) {
          for (const photo of dbPhotos) {
            const { data: urlData } = supabase.storage
              .from('job-photos')
              .getPublicUrl(photo.storage_path);
            
            items.push({
              id: photo.id,
              url: urlData.publicUrl,
              caption: photo.caption,
              photoType: (photo.photo_type as 'before' | 'after') || 'after',
              isQueued: false,
              storagePath: photo.storage_path,
            });
          }
        }
      }

      // Load queued photos from IndexedDB
      const offlinePhotos = await offlineDb.getPhotosForLead(leadId);
      for (const photo of offlinePhotos) {
        if (!photo.uploaded && !photo.markedForDeletion) {
          items.push({
            id: photo.id,
            url: photo.base64Data,
            caption: photo.caption,
            photoType: photo.photoType || 'after',
            isQueued: true,
          });
        }
      }

      setPhotos(items);
    } catch (error) {
      console.error('Error loading photos:', error);
    } finally {
      setLoading(false);
    }
  }, [leadId, isOnline]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos, refreshKey]);

  // Refresh when coming online
  useEffect(() => {
    if (isOnline) {
      loadPhotos();
    }
  }, [isOnline, loadPhotos]);

  const handleDeleteConfirm = async () => {
    if (!photoToDelete || !onDeletePhoto) return;
    
    await onDeletePhoto(photoToDelete.id, photoToDelete.storagePath);
    setPhotoToDelete(null);
    // Refresh after delete
    await loadPhotos();
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground font-medium">Photos</p>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="aspect-square rounded-lg" />
          <Skeleton className="aspect-square rounded-lg" />
        </div>
      </div>
    );
  }

  if (photos.length === 0) {
    return null;
  }

  const beforePhotos = photos.filter(p => p.photoType === 'before');
  const afterPhotos = photos.filter(p => p.photoType === 'after');

  const renderPhotoGrid = (photoList: PhotoItem[], sectionTitle: string) => {
    if (photoList.length === 0) return null;
    
    const queuedCount = photoList.filter(p => p.isQueued).length;
    const uploadedCount = photoList.filter(p => !p.isQueued).length;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">{sectionTitle}</p>
          {uploadedCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/10 text-green-700 border-green-200">
              <Cloud className="h-2.5 w-2.5 mr-0.5" />
              {uploadedCount}
            </Badge>
          )}
          {queuedCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-yellow-500/10 text-yellow-700 border-yellow-200">
              <Clock className="h-2.5 w-2.5 mr-0.5" />
              {queuedCount}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {photoList.map((photo) => (
            <SwipeablePhoto
              key={photo.id}
              id={photo.id}
              url={photo.url}
              caption={photo.caption}
              photoType={photo.photoType}
              isQueued={photo.isQueued}
              onClick={() => setSelectedPhoto(photo)}
              onDelete={() => setPhotoToDelete(photo)}
              deleting={deleting}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-4">
        {renderPhotoGrid(beforePhotos, "Before")}
        {renderPhotoGrid(afterPhotos, "After")}
      </div>

      {/* Full-size preview dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/95">
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-2 right-2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>
          {selectedPhoto && (
            <div className="relative flex items-center justify-center min-h-[50vh]">
              <img
                src={selectedPhoto.url}
                alt={selectedPhoto.caption || 'Photo preview'}
                className="max-w-full max-h-[85vh] object-contain"
              />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                <Badge className={selectedPhoto.photoType === 'before' ? 'bg-blue-600' : 'bg-green-600'}>
                  {selectedPhoto.photoType === 'before' ? 'Before' : 'After'}
                </Badge>
                {selectedPhoto.isQueued && (
                  <Badge className="bg-yellow-500 text-black">
                    <Clock className="h-3 w-3 mr-1" />
                    Queued
                  </Badge>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!photoToDelete} onOpenChange={() => setPhotoToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Photo?</AlertDialogTitle>
            <AlertDialogDescription>
              {photoToDelete?.isQueued 
                ? "This queued photo will be removed and won't be uploaded."
                : isOnline 
                  ? "This photo will be permanently deleted."
                  : "This photo will be deleted when you're back online."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Cloud, Clock, Plus, Camera, Trash2 } from 'lucide-react';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  onAddPhotos?: () => void;
  deleting?: boolean;
  refreshKey?: number;
}

export function PhotoGallery({ 
  leadId, 
  isOnline, 
  onDeletePhoto,
  onAddPhotos,
  deleting,
  refreshKey = 0,
}: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<PhotoItem | null>(null);
  const [deleteAllMode, setDeleteAllMode] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState<PhotoItem[]>([]);

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

  const handleDeleteRequest = (photo: PhotoItem) => {
    // Add to pending deletes queue
    setPendingDeletes(prev => [...prev, photo]);
    setPhotoToDelete(photo);
  };

  const handleDeleteConfirm = async () => {
    if (!photoToDelete || !onDeletePhoto) return;
    
    await onDeletePhoto(photoToDelete.id, photoToDelete.storagePath);
    
    // Remove from pending deletes
    setPendingDeletes(prev => prev.filter(p => p.id !== photoToDelete.id));
    setPhotoToDelete(null);
    
    // Refresh after delete
    await loadPhotos();
  };

  const handleDeleteAllConfirm = async () => {
    if (!onDeletePhoto || pendingDeletes.length === 0) return;
    
    // Delete all pending photos
    for (const photo of pendingDeletes) {
      await onDeletePhoto(photo.id, photo.storagePath);
    }
    
    setPendingDeletes([]);
    setDeleteAllMode(false);
    setPhotoToDelete(null);
    
    // Refresh after delete
    await loadPhotos();
  };

  const handleIgnoreDelete = () => {
    // Remove current photo from pending
    if (photoToDelete) {
      setPendingDeletes(prev => prev.filter(p => p.id !== photoToDelete.id));
    }
    setPhotoToDelete(null);
  };

  const handleIgnoreAll = () => {
    setPendingDeletes([]);
    setPhotoToDelete(null);
    setDeleteAllMode(false);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="aspect-square rounded-lg" />
          <Skeleton className="aspect-square rounded-lg" />
        </div>
      </div>
    );
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
        <div className="max-h-48 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {photoList.map((photo) => (
              <div key={photo.id} className="relative group">
                <button
                  onClick={() => setSelectedPhoto(photo)}
                  disabled={deleting}
                  className={`w-full aspect-square rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary bg-muted ${
                    photo.isQueued ? 'opacity-80' : ''
                  }`}
                >
                  <img
                    src={photo.url}
                    alt={photo.caption || `${photo.photoType} photo`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                </button>

                {/* Delete button */}
                {onDeletePhoto && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteRequest(photo);
                    }}
                    disabled={deleting}
                    className="absolute top-1 right-1 p-1.5 rounded-full bg-red-500/90 hover:bg-red-600 text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity md:opacity-100"
                    aria-label="Delete photo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Status badge */}
                {photo.isQueued && (
                  <div className="absolute top-1 left-1 pointer-events-none">
                    <Badge className="bg-yellow-500/90 text-[10px] px-1.5 py-0 h-4">
                      <Clock className="h-2.5 w-2.5 mr-0.5" />
                      Queued
                    </Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-4">
        {/* Add Photos Button */}
        {onAddPhotos && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-9 gap-2 border-dashed"
            onClick={onAddPhotos}
          >
            <Plus className="h-4 w-4" />
            <Camera className="h-4 w-4" />
            Add Photos
          </Button>
        )}

        {beforePhotos.length === 0 && afterPhotos.length === 0 && !onAddPhotos && (
          <p className="text-xs text-muted-foreground text-center py-2">No photos yet</p>
        )}

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

      {/* Delete confirmation dialog with Delete All option */}
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
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <div className="flex gap-2 w-full sm:w-auto">
              <AlertDialogCancel onClick={handleIgnoreDelete} className="flex-1 sm:flex-none">
                Ignore
              </AlertDialogCancel>
              {pendingDeletes.length > 1 && (
                <Button
                  variant="outline"
                  onClick={handleIgnoreAll}
                  className="flex-1 sm:flex-none"
                >
                  Ignore All ({pendingDeletes.length})
                </Button>
              )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <AlertDialogAction 
                onClick={handleDeleteConfirm}
                className="bg-red-600 hover:bg-red-700 flex-1 sm:flex-none"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </AlertDialogAction>
              {pendingDeletes.length > 1 && (
                <Button
                  variant="destructive"
                  onClick={handleDeleteAllConfirm}
                  className="flex-1 sm:flex-none"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete All ({pendingDeletes.length})
                </Button>
              )}
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

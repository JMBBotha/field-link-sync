import { useState, useEffect, useCallback } from 'react';
import { Cloud, Clock, Plus, Trash2 } from 'lucide-react';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  onPhotoClick?: (photo: PhotoItem, index: number, allPhotos: PhotoItem[]) => void;
  deleting?: boolean;
  refreshKey?: number;
  compact?: boolean;
}

export function PhotoGallery({ 
  leadId, 
  isOnline, 
  onDeletePhoto,
  onAddPhotos,
  onPhotoClick,
  deleting,
  refreshKey = 0,
  compact = false,
}: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      <div className="grid grid-cols-4 gap-1.5">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  const beforePhotos = photos.filter(p => p.photoType === 'before');
  const afterPhotos = photos.filter(p => p.photoType === 'after');
  const allPhotos = [...beforePhotos, ...afterPhotos];

  // Compact inline grid view
  if (compact || allPhotos.length === 0) {
    return (
      <>
        <div className="space-y-2">
          {allPhotos.length === 0 ? (
            onAddPhotos ? (
              <button
                onClick={onAddPhotos}
                className="text-xs text-primary hover:text-primary/80 hover:underline text-center py-3 w-full flex items-center justify-center gap-1 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add Photos
              </button>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-3">No photos yet</p>
            )
          ) : (
            <>
              {/* Single row of thumbnails filling 90% of container */}
              <div className="flex gap-1.5 w-[90%]">
                {allPhotos.slice(0, 4).map((photo, index) => (
                  <button
                    key={photo.id}
                    onClick={() => onPhotoClick?.(photo, index, allPhotos)}
                    className="relative flex-1 aspect-square rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary bg-muted/50"
                  >
                    <img
                      src={photo.url}
                      alt={photo.caption || `Photo ${index + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                    {/* Type indicator */}
                    <div className="absolute bottom-0.5 left-0.5">
                      <div className={`h-1.5 w-1.5 rounded-full ${photo.photoType === 'before' ? 'bg-blue-500' : 'bg-green-500'}`} />
                    </div>
                    {/* Queued indicator */}
                    {photo.isQueued && (
                      <div className="absolute top-0.5 right-0.5">
                        <Clock className="h-2.5 w-2.5 text-yellow-500" />
                      </div>
                    )}
                  </button>
                ))}
                {allPhotos.length > 4 && (
                  <div className="flex-1 aspect-square rounded-lg bg-black/30 flex items-center justify-center text-xs text-white font-medium">
                    +{allPhotos.length - 4}
                  </div>
                )}
              </div>
              
              {/* Add photos link */}
              {onAddPhotos && (
                <button
                  onClick={onAddPhotos}
                  className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  <Plus className="h-2.5 w-2.5" />
                  Add
                </button>
              )}
            </>
          )}
        </div>

        {/* Delete confirmation */}
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
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // Full grid view with sections
  const renderPhotoGrid = (photoList: PhotoItem[], sectionTitle: string, startIndex: number) => {
    if (photoList.length === 0) return null;
    
    const queuedCount = photoList.filter(p => p.isQueued).length;
    const uploadedCount = photoList.filter(p => !p.isQueued).length;

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{sectionTitle}</p>
          {uploadedCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 bg-green-500/10 text-green-700 border-green-200">
              <Cloud className="h-2 w-2 mr-0.5" />
              {uploadedCount}
            </Badge>
          )}
          {queuedCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 bg-yellow-500/10 text-yellow-700 border-yellow-200">
              <Clock className="h-2 w-2 mr-0.5" />
              {queuedCount}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {photoList.map((photo, idx) => (
            <button
              key={photo.id}
              onClick={() => onPhotoClick?.(photo, startIndex + idx, allPhotos)}
              disabled={deleting}
              className={`relative aspect-square rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary bg-muted ${
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

              {/* Queued badge */}
              {photo.isQueued && (
                <div className="absolute top-0.5 right-0.5">
                  <Badge className="bg-yellow-500/90 text-[8px] px-1 py-0 h-3.5">
                    <Clock className="h-2 w-2" />
                  </Badge>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-3">
        {renderPhotoGrid(beforePhotos, "Before", 0)}
        {renderPhotoGrid(afterPhotos, "After", beforePhotos.length)}
        
        {/* Add photos link */}
        {onAddPhotos && (
          <button
            onClick={onAddPhotos}
            className="text-xs text-primary hover:underline flex items-center gap-0.5 pt-1"
          >
            <Plus className="h-3 w-3" />
            Add Photos
          </button>
        )}
      </div>

      {/* Delete confirmation */}
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
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

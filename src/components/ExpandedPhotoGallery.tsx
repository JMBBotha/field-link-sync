import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Cloud, Clock, ImageIcon, ChevronLeft, ChevronRight, Trash2, Check, CheckSquare } from 'lucide-react';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  createdAt?: string;
}

interface ExpandedPhotoGalleryProps {
  leadId: string;
  isOnline: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeletePhoto?: (photoId: string, storagePath?: string) => Promise<void>;
  refreshKey?: number;
}

export function ExpandedPhotoGallery({ 
  leadId, 
  isOnline, 
  open,
  onOpenChange,
  onDeletePhoto,
  refreshKey = 0,
}: ExpandedPhotoGalleryProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const items: PhotoItem[] = [];

      // Load uploaded photos from Supabase
      if (isOnline) {
        const { data: dbPhotos } = await supabase
          .from('job_photos')
          .select('id, storage_path, caption, photo_type, created_at')
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
              createdAt: photo.created_at,
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
    if (open) {
      loadPhotos();
      setSelectedIds(new Set());
      setIsMultiSelectMode(false);
    }
  }, [open, loadPhotos, refreshKey]);

  const handlePrevious = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < photos.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };

  // Swipe handling for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || selectedIndex === null) return;
    
    const touchEnd = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    const diffX = touchStartRef.current.x - touchEnd.x;
    const diffY = Math.abs(touchStartRef.current.y - touchEnd.y);
    
    // Only trigger swipe if horizontal movement is significant and vertical is minimal
    if (Math.abs(diffX) > 50 && diffY < 100) {
      if (diffX > 0 && selectedIndex < photos.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (diffX < 0 && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
    }
    
    touchStartRef.current = null;
  };

  // Long press to enter multi-select mode
  const handleLongPressStart = (photoId: string) => {
    longPressTimerRef.current = setTimeout(() => {
      setIsMultiSelectMode(true);
      setSelectedIds(new Set([photoId]));
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const togglePhotoSelection = (photoId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
        if (newSet.size === 0) {
          setIsMultiSelectMode(false);
        }
      } else {
        newSet.add(photoId);
      }
      return newSet;
    });
  };

  const handlePhotoClick = (photo: PhotoItem, index: number) => {
    if (isMultiSelectMode) {
      togglePhotoSelection(photo.id);
    } else {
      setSelectedIndex(index);
    }
  };

  const handleDeleteSelected = async () => {
    if (!onDeletePhoto || selectedIds.size === 0) return;
    
    setDeleting(true);
    try {
      for (const id of selectedIds) {
        const photo = photos.find(p => p.id === id);
        if (photo) {
          await onDeletePhoto(photo.id, photo.storagePath);
        }
      }
      setSelectedIds(new Set());
      setIsMultiSelectMode(false);
      await loadPhotos();
    } catch (error) {
      console.error('Error deleting photos:', error);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDeleteCurrent = async () => {
    if (!onDeletePhoto || selectedIndex === null) return;
    
    const photo = photos[selectedIndex];
    if (!photo) return;
    
    setDeleting(true);
    try {
      await onDeletePhoto(photo.id, photo.storagePath);
      
      // Adjust index after deletion
      if (photos.length <= 1) {
        setSelectedIndex(null);
      } else if (selectedIndex >= photos.length - 1) {
        setSelectedIndex(photos.length - 2);
      }
      
      await loadPhotos();
    } catch (error) {
      console.error('Error deleting photo:', error);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const cancelMultiSelect = () => {
    setIsMultiSelectMode(false);
    setSelectedIds(new Set());
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] p-0 gap-0 overflow-hidden [&>button]:hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b shrink-0">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Photos</h3>
              <Badge variant="secondary" className="text-xs">{photos.length}</Badge>
            </div>
            <div className="flex items-center gap-1">
              {isMultiSelectMode ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={cancelMultiSelect}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete ({selectedIds.size})
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Multi-select hint */}
          {!isMultiSelectMode && photos.length > 0 && (
            <p className="text-[10px] text-muted-foreground text-center py-1 bg-muted/30">
              Long-press or tap checkbox to select multiple
            </p>
          )}

          {/* Photo Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="grid grid-cols-3 gap-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="aspect-square bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : photos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No photos yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="relative aspect-square group"
                    onTouchStart={() => handleLongPressStart(photo.id)}
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                  >
                    <button
                      className="w-full h-full rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary bg-muted"
                      onClick={() => handlePhotoClick(photo, index)}
                    >
                      <img
                        src={photo.url}
                        alt={photo.caption || `Photo ${index + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    </button>

                    {/* Multi-select checkbox */}
                    <button
                      className={`absolute top-1.5 left-1.5 h-5 w-5 rounded border-2 flex items-center justify-center transition-all ${
                        selectedIds.has(photo.id)
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-black/40 border-white/70 text-transparent hover:bg-black/60'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isMultiSelectMode) {
                          setIsMultiSelectMode(true);
                        }
                        togglePhotoSelection(photo.id);
                      }}
                    >
                      <Check className="h-3 w-3" />
                    </button>

                    {/* Type badge */}
                    <div className="absolute bottom-1.5 left-1.5">
                      <Badge 
                        className={`text-[9px] px-1 py-0 h-4 ${
                          photo.photoType === 'before' ? 'bg-blue-600' : 'bg-green-600'
                        }`}
                      >
                        {photo.photoType === 'before' ? 'B' : 'A'}
                      </Badge>
                    </div>

                    {/* Sync status */}
                    <div className="absolute bottom-1.5 right-1.5">
                      {photo.isQueued ? (
                        <Badge className="bg-yellow-500 text-black text-[9px] px-1 py-0 h-4">
                          <Clock className="h-2.5 w-2.5" />
                        </Badge>
                      ) : (
                        <Badge className="bg-green-600/80 text-white text-[9px] px-1 py-0 h-4">
                          <Cloud className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Full-size preview dialog with swipe navigation */}
      <Dialog open={selectedIndex !== null} onOpenChange={() => setSelectedIndex(null)}>
        <DialogContent 
          className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-black/95 border-none"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Top bar with close and delete */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 to-transparent">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-white hover:bg-white/20"
              onClick={() => setSelectedIndex(null)}
            >
              <X className="h-5 w-5" />
            </Button>
            
            {onDeletePhoto && selectedIndex !== null && photos[selectedIndex] && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-red-400 hover:text-red-300 hover:bg-red-500/20"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>

          {/* Navigation buttons */}
          {selectedIndex !== null && selectedIndex > 0 && (
            <button
              onClick={handlePrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {selectedIndex !== null && selectedIndex < photos.length - 1 && (
            <button
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          {selectedIndex !== null && photos[selectedIndex] && (
            <div className="relative flex items-center justify-center min-h-[50vh] pt-12 pb-16">
              <img
                src={photos[selectedIndex].url}
                alt={photos[selectedIndex].caption || 'Photo preview'}
                className="max-w-full max-h-[85vh] object-contain"
              />
              {/* Bottom info bar */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
                <Badge className={photos[selectedIndex].photoType === 'before' ? 'bg-blue-600' : 'bg-green-600'}>
                  {photos[selectedIndex].photoType === 'before' ? 'Before' : 'After'}
                </Badge>
                {photos[selectedIndex].isQueued && (
                  <Badge className="bg-yellow-500 text-black">
                    <Clock className="h-3 w-3 mr-1" />
                    Queued
                  </Badge>
                )}
                <span className="text-white/70 text-sm">
                  {selectedIndex + 1} / {photos.length}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {isMultiSelectMode && selectedIds.size > 1 
                ? `${selectedIds.size} photos` 
                : 'photo'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOnline 
                ? "This action cannot be undone. The photo(s) will be permanently deleted."
                : "The photo(s) will be queued for deletion when you're back online."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={isMultiSelectMode ? handleDeleteSelected : handleDeleteCurrent}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

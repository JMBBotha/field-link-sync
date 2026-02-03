import { useState, useEffect, useCallback } from 'react';
import { X, Cloud, Clock, ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

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
}

export function ExpandedPhotoGallery({ 
  leadId, 
  isOnline, 
  open,
  onOpenChange,
}: ExpandedPhotoGalleryProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

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
    }
  }, [open, loadPhotos]);

  const beforePhotos = photos.filter(p => p.photoType === 'before');
  const afterPhotos = photos.filter(p => p.photoType === 'after');

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

  const renderPhotoRow = (photoList: PhotoItem[], title: string, startIndex: number) => {
    if (photoList.length === 0) return null;
    
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <h4 className="text-sm font-medium">{title}</h4>
          <Badge variant="outline" className="text-xs">
            {photoList.length}
          </Badge>
        </div>
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            {photoList.map((photo, idx) => (
              <button
                key={photo.id}
                onClick={() => setSelectedIndex(startIndex + idx)}
                className="relative shrink-0 rounded-lg overflow-hidden group focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <img
                  src={photo.url}
                  alt={photo.caption || `${title} photo`}
                  className="h-24 w-24 sm:h-32 sm:w-32 object-cover transition-transform group-hover:scale-105"
                />
                {photo.isQueued && (
                  <div className="absolute top-1 right-1">
                    <Badge className="bg-yellow-500 text-black text-[10px] px-1 py-0">
                      <Clock className="h-2.5 w-2.5" />
                    </Badge>
                  </div>
                )}
                {!photo.isQueued && (
                  <div className="absolute top-1 right-1">
                    <Badge className="bg-green-600 text-white text-[10px] px-1 py-0">
                      <Cloud className="h-2.5 w-2.5" />
                    </Badge>
                  </div>
                )}
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[80vh] p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b shrink-0">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Job Photos</h3>
              <Badge variant="secondary">{photos.length}</Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="p-4 space-y-4">
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-24" />
                  <div className="flex gap-2">
                    <Skeleton className="h-24 w-24 rounded-lg" />
                    <Skeleton className="h-24 w-24 rounded-lg" />
                    <Skeleton className="h-24 w-24 rounded-lg" />
                  </div>
                </div>
              ) : photos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No photos yet</p>
                </div>
              ) : (
                <>
                  {renderPhotoRow(beforePhotos, "Before", 0)}
                  {renderPhotoRow(afterPhotos, "After", beforePhotos.length)}
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Full-size preview dialog */}
      <Dialog open={selectedIndex !== null} onOpenChange={() => setSelectedIndex(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-black/95 border-none">
          {/* Close button */}
          <button
            onClick={() => setSelectedIndex(null)}
            className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Navigation buttons */}
          {selectedIndex !== null && selectedIndex > 0 && (
            <button
              onClick={handlePrevious}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {selectedIndex !== null && selectedIndex < photos.length - 1 && (
            <button
              onClick={handleNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          {selectedIndex !== null && photos[selectedIndex] && (
            <div className="relative flex items-center justify-center min-h-[50vh]">
              <img
                src={photos[selectedIndex].url}
                alt={photos[selectedIndex].caption || 'Photo preview'}
                className="max-w-full max-h-[90vh] object-contain"
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
    </>
  );
}

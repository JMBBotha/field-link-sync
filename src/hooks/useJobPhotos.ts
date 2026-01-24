import { useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type PhotoType = 'before' | 'after';

interface UseJobPhotosOptions {
  leadId: string;
  agentId: string;
  isOnline: boolean;
  queueOperation: (
    operationType: any,
    tableName: string,
    recordId: string,
    data: any
  ) => Promise<string | void>;
}

interface UseJobPhotosResult {
  uploading: boolean;
  pendingCount: number;
  uploadPhoto: (file: File, photoType: PhotoType) => Promise<void>;
  deletePhoto: (photoId: string, storagePath?: string) => Promise<void>;
  deleting: boolean;
}

const COMPRESSION_OPTIONS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

export function useJobPhotos({
  leadId,
  agentId,
  isOnline,
  queueOperation,
}: UseJobPhotosOptions): UseJobPhotosResult {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const { toast } = useToast();

  // Compress and convert to base64
  const compressImage = async (file: File): Promise<{ base64: string; compressed: File }> => {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ 
        base64: reader.result as string, 
        compressed 
      });
      reader.onerror = reject;
      reader.readAsDataURL(compressed);
    });
  };

  // Upload directly to Supabase storage
  const uploadToStorage = async (file: File, photoId: string): Promise<string> => {
    const filePath = `${leadId}/${photoId}.jpg`;
    
    const { error } = await supabase.storage
      .from('job-photos')
      .upload(filePath, file, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;
    return filePath;
  };

  const uploadPhoto = useCallback(async (file: File, photoType: PhotoType) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    const photoId = crypto.randomUUID();

    try {
      // Compress the image
      const { base64, compressed } = await compressImage(file);

      if (isOnline) {
        // Upload directly
        const storagePath = await uploadToStorage(compressed, photoId);
        
        // Save to database with photo_type
        await supabase.from('job_photos').insert({
          id: photoId,
          lead_id: leadId,
          storage_path: storagePath,
          uploaded_by: agentId,
          photo_type: photoType,
          synced_from_offline: false,
        });

        toast({
          title: "Photo uploaded ✓",
          description: `${photoType === 'before' ? 'Before' : 'After'} photo saved`,
        });
      } else {
        // Queue for offline sync
        await offlineDb.savePhoto({
          id: photoId,
          leadId,
          base64Data: base64,
          fileName: file.name,
          mimeType: 'image/jpeg',
          caption: null,
          photoType,
          capturedAt: Date.now(),
        });

        // Queue the upload operation
        await queueOperation(
          'upload_photo',
          'job_photos',
          photoId,
          {
            uploaded_by: agentId,
            photo_type: photoType,
          }
        );

        // Update pending count
        const pending = await offlineDb.getPendingPhotos();
        setPendingCount(pending.filter(p => p.leadId === leadId).length);

        toast({
          title: "Photo queued for sync",
          description: `${photoType === 'before' ? 'Before' : 'After'} photo will upload when online`,
        });
      }
    } catch (error: any) {
      console.error('Photo upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to process photo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }, [leadId, agentId, isOnline, queueOperation, toast]);

  const deletePhoto = useCallback(async (photoId: string, storagePath?: string) => {
    setDeleting(true);

    try {
      if (isOnline && storagePath) {
        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from('job-photos')
          .remove([storagePath]);
        
        if (storageError) {
          console.error('Storage delete error:', storageError);
        }

        // Delete from database
        const { error: dbError } = await supabase
          .from('job_photos')
          .delete()
          .eq('id', photoId);

        if (dbError) throw dbError;

        toast({
          title: "Photo deleted",
          description: "Photo removed successfully",
        });
      } else if (!storagePath) {
        // It's a queued photo - just remove from IndexedDB
        await offlineDb.deletePhoto(photoId);
        
        // Update pending count
        const pending = await offlineDb.getPendingPhotos();
        setPendingCount(pending.filter(p => p.leadId === leadId).length);

        toast({
          title: "Photo removed",
          description: "Queued photo removed",
        });
      } else {
        // Offline but needs server deletion - queue it
        // Mark the photo for deletion in IndexedDB
        await offlineDb.photos.update(photoId, { markedForDeletion: true });
        
        await queueOperation(
          'delete_photo',
          'job_photos',
          photoId,
          {
            storage_path: storagePath,
          }
        );

        toast({
          title: "Delete queued",
          description: "Photo will be deleted when online",
        });
      }
    } catch (error: any) {
      console.error('Photo delete error:', error);
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete photo",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }, [leadId, isOnline, queueOperation, toast]);

  return {
    uploading,
    pendingCount,
    uploadPhoto,
    deletePhoto,
    deleting,
  };
}

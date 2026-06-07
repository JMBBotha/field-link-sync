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
  ) => Promise<any | void>;
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

  const compressImage = async (file: File): Promise<{ base64: string; compressed: File }> => {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(compressed);
      reader.onload = () => resolve({ base64: reader.result as string, compressed });
      reader.onerror = reject;
    });
  };

  const uploadPhoto = useCallback(async (file: File, photoType: PhotoType) => {
    if (!leadId || !agentId) {
      toast({ title: "Error", description: "Missing lead or agent information", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const { base64 } = await compressImage(file);
      const photoId = crypto.randomUUID();

      const photoRecord = {
        id: photoId,
        leadId,
        agentId,
        base64Data: base64,
        fileName: file.name,
        mimeType: 'image/jpeg',
        photoType,
        capturedAt: Date.now(),
        synced: false
      };

      await offlineDb.savePhoto(photoRecord);
      await queueOperation('upload_photo', 'job_photos', photoId, photoRecord).catch(() => {});

      toast({ title: "Photo saved locally" });
    } catch (error) {
      console.error('Failed to upload photo:', error);
      toast({ title: "Error", description: "Failed to upload photo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [leadId, agentId, queueOperation, toast]);

  const deletePhoto = useCallback(async (photoId: string, storagePath?: string) => {
    setDeleting(true);
    try {
      await offlineDb.deletePhoto(photoId);
      if (isOnline) {
        await queueOperation('delete_photo', 'job_photos', photoId, { storagePath }).catch(() => {});
      }
      toast({ title: "Photo deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete photo", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }, [isOnline, queueOperation, toast]);

  return {
    uploading,
    pendingCount,
    uploadPhoto,
    deletePhoto,
    deleting
  };
}
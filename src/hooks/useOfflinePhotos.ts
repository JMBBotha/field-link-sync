import { useState, useCallback, useEffect } from 'react';
import { offlineDb, OfflinePhoto } from '@/lib/offlineDb';
import { useToast } from '@/hooks/use-toast';

interface UseOfflinePhotosResult {
  photos: OfflinePhoto[];
  pendingCount: number;
  loading: boolean;
  loadPhotos: (leadId: string) => Promise<void>;
  savePhoto: (
    leadId: string,
    agentId: string,
    file: File,
    caption?: string
  ) => Promise<string>;
  deletePhoto: (photoId: string) => Promise<void>;
  getPendingPhotos: () => Promise<OfflinePhoto[]>;
}

export function useOfflinePhotos(): UseOfflinePhotosResult {
  const [photos, setPhotos] = useState<OfflinePhoto[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Load pending count on mount
  useEffect(() => {
    loadPendingCount();
  }, []);

  const loadPendingCount = async () => {
    try {
      const pending = await offlineDb.getPendingPhotos();
      setPendingCount(pending.length);
    } catch (error) {
      console.error('Failed to load pending photo count:', error);
    }
  };

  // Load photos for a specific lead
  const loadPhotos = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      const leadPhotos = await offlineDb.getPhotosForLead(leadId);
      setPhotos(leadPhotos);
    } catch (error) {
      console.error('Failed to load photos:', error);
      toast({
        title: "Error",
        description: "Failed to load photos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  // Save a photo locally
  const savePhoto = useCallback(async (
    leadId: string,
    agentId: string,
    file: File,
    caption?: string
  ): Promise<string> => {
    const photoId = crypto.randomUUID();
    
    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Invalid file type. Please select an image.');
      }

      // Check file size (max 10MB)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File is too large. Maximum size is 10MB.');
      }

      // Convert to base64
      const base64Data = await fileToBase64(file);

      // Create photo record
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
      await loadPendingCount();

      return photoId;
    } catch (error: any) {
      console.error('Failed to save photo:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save photo",
        variant: "destructive",
      });
      throw error;
    }
  }, [toast]);

  // Delete a photo
  const deletePhoto = useCallback(async (photoId: string) => {
    try {
      await offlineDb.deletePhoto(photoId);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      await loadPendingCount();
    } catch (error) {
      console.error('Failed to delete photo:', error);
      toast({
        title: "Error",
        description: "Failed to delete photo",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Get all pending photos
  const getPendingPhotos = useCallback(async (): Promise<OfflinePhoto[]> => {
    return offlineDb.getPendingPhotos();
  }, []);

  return {
    photos,
    pendingCount,
    loading,
    loadPhotos,
    savePhoto,
    deletePhoto,
    getPendingPhotos,
  };
}

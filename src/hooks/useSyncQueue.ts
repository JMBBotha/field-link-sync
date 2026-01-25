import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { offlineDb, PendingOperation, OperationType } from '@/lib/offlineDb';
import { useToast } from '@/hooks/use-toast';

export interface SyncStatus {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: number | null;
  lastError: string | null;
  failedOperations: number;
  pendingByType: Record<OperationType, number>;
}

export function useSyncQueue(isOnline: boolean) {
  const { toast } = useToast();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    lastError: null,
    failedOperations: 0,
    pendingByType: {
      update_lead: 0,
      update_job_status: 0,
      create_invoice: 0,
      update_invoice: 0,
      update_equipment: 0,
      update_agent_location: 0,
      upload_photo: 0,
      delete_photo: 0,
      update_timer_log: 0,
    },
  });
  
  const syncingRef = useRef(false);
  const retryTimeoutRef = useRef<number | null>(null);

  // Load pending count on mount
  useEffect(() => {
    loadPendingCount();
  }, []);

  const loadPendingCount = useCallback(async () => {
    try {
      const count = await offlineDb.getPendingCount();
      const byType = await offlineDb.getPendingOperationsByType();
      const failed = await offlineDb.getFailedOperations();
      setSyncStatus(prev => ({ 
        ...prev, 
        pendingCount: count,
        pendingByType: byType,
        failedOperations: failed.length,
      }));
    } catch (error) {
      console.error('[SyncQueue] Error loading pending count:', error);
    }
  }, []);

  // Queue a new operation
  const queueOperation = useCallback(async (
    operationType: PendingOperation['operationType'],
    tableName: string,
    recordId: string,
    data: any
  ) => {
    try {
      await offlineDb.queueOperation({
        operationType,
        tableName,
        recordId,
        data,
        timestamp: Date.now(),
      });
      
      await loadPendingCount();
      
      // If online, try to sync immediately
      if (isOnline && !syncingRef.current) {
        syncPendingOperations();
      }
    } catch (error) {
      console.error('[SyncQueue] Error queuing operation:', error);
    }
  }, [isOnline, loadPendingCount]);

  // Check for conflicts before updating
  const checkForConflict = async (
    tableName: string, 
    recordId: string, 
    operationTimestamp: number
  ): Promise<{ hasConflict: boolean; serverUpdatedAt?: string }> => {
    try {
      if (tableName === 'leads') {
        const { data, error } = await supabase
          .from('leads')
          .select('created_at')
          .eq('id', recordId)
          .single();
        
        if (error || !data) return { hasConflict: false };
        
        // For leads, we use created_at as a proxy since we don't have updated_at
        // In a real scenario, you'd add an updated_at column
        return { hasConflict: false };
      }
      return { hasConflict: false };
    } catch {
      return { hasConflict: false };
    }
  };

  // Map legacy status values to valid database values
  const normalizeLeadStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      'open': 'pending',
      'released': 'pending',
      'claimed': 'accepted',
      'available': 'pending',
    };
    return statusMap[status] || status;
  };

  // Normalize lead data before syncing to ensure valid status values
  const normalizeLeadData = (data: any): any => {
    if (!data) return data;
    const normalized = { ...data };
    if (normalized.status) {
      normalized.status = normalizeLeadStatus(normalized.status);
    }
    return normalized;
  };

  // Process a single operation
  const processOperation = async (operation: PendingOperation): Promise<boolean> => {
    try {
      // Check for conflicts on updates
      if (operation.operationType === 'update_lead' || operation.operationType === 'update_job_status') {
        const { hasConflict } = await checkForConflict(
          operation.tableName, 
          operation.recordId, 
          operation.timestamp
        );
        
        if (hasConflict) {
          toast({
            title: "Job Updated by Admin",
            description: "This job was modified while you were offline. Your changes were merged.",
            variant: "default",
          });
        }
      }

      switch (operation.operationType) {
        case 'update_lead':
        case 'update_job_status': {
          // Normalize status values before syncing
          const normalizedData = normalizeLeadData(operation.data);
          
          const { error } = await supabase
            .from('leads')
            .update(normalizedData)
            .eq('id', operation.recordId);
          
          if (error) throw error;
          break;
        }
        
        case 'create_invoice': {
          const { error } = await supabase
            .from('invoices')
            .insert(operation.data);
          
          if (error) throw error;
          break;
        }
        
        case 'update_invoice': {
          const { error } = await supabase
            .from('invoices')
            .update(operation.data)
            .eq('id', operation.recordId);
          
          if (error) throw error;
          break;
        }
        
        case 'update_equipment': {
          const { error } = await supabase
            .from('equipment')
            .update(operation.data)
            .eq('id', operation.recordId);
          
          if (error) throw error;
          break;
        }

        case 'update_agent_location': {
          const { error } = await supabase
            .from('agent_locations')
            .upsert({
              agent_id: operation.recordId,
              ...operation.data,
              last_updated: new Date().toISOString(),
            }, { onConflict: 'agent_id' });
          
          if (error) throw error;
          
          // Also mark local availability as synced
          await offlineDb.markAvailabilitySynced(operation.recordId);
          break;
        }

        case 'upload_photo': {
          // Fetch the photo data from IndexedDB using the recordId (photoId)
          const photoId = operation.recordId;
          const offlinePhoto = await offlineDb.photos.get(photoId);
          
          if (!offlinePhoto) {
            console.warn('[SyncQueue] Photo not found in IndexedDB:', photoId);
            // Photo might have been deleted, mark as synced to clear queue
            break;
          }

          const { leadId, base64Data, fileName, mimeType, caption } = offlinePhoto;
          
          // Convert base64 to blob
          const base64Content = base64Data.includes(',') 
            ? base64Data.split(',')[1] 
            : base64Data;
          const byteCharacters = atob(base64Content);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: mimeType });

          // Upload to storage with unique path
          const storagePath = `${leadId}/${photoId}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('job-photos')
            .upload(storagePath, blob, { 
              contentType: mimeType,
              upsert: true,
            });

          if (uploadError) throw uploadError;

          // Create record in job_photos table
          const { error: dbError } = await supabase
            .from('job_photos')
            .insert({
              id: photoId,
              lead_id: leadId,
              storage_path: storagePath,
              caption: caption || null,
              photo_type: offlinePhoto.photoType || operation.data.photo_type || 'after',
              uploaded_by: operation.data.uploaded_by,
              synced_from_offline: true,
            });

          if (dbError) throw dbError;

          // Mark local photo as uploaded and clean up base64 data
          await offlineDb.markPhotoUploaded(photoId);
          
          // Optionally delete the base64 data to free space (keep record for reference)
          await offlineDb.photos.update(photoId, { 
            base64Data: '', // Clear the large base64 data
            uploaded: true 
          });
          
          break;
        }

        case 'delete_photo': {
          const { storage_path } = operation.data;
          const photoId = operation.recordId;

          // Delete from storage if path exists
          if (storage_path) {
            const { error: storageError } = await supabase.storage
              .from('job-photos')
              .remove([storage_path]);
            
            if (storageError) {
              console.error('[SyncQueue] Storage delete error:', storageError);
              // Continue anyway - the file might already be deleted
            }
          }

          // Delete from database
          const { error: dbError } = await supabase
            .from('job_photos')
            .delete()
            .eq('id', photoId);

          if (dbError) throw dbError;

          // Clean up local record
          await offlineDb.deletePhoto(photoId);
          break;
        }

        case 'update_timer_log': {
          // Update lead with timer data
          const { leadId, totalElapsedMs } = operation.data;
          
          // Timer logs are informational - we could store them in a separate table
          // For now, we just mark them as synced
          await offlineDb.markTimerLogSynced(operation.recordId);
          break;
        }
        
        default:
          console.warn('[SyncQueue] Unknown operation type:', operation.operationType);
          return false;
      }
      
      return true;
    } catch (error: any) {
      console.error('[SyncQueue] Operation failed:', {
        type: operation.operationType,
        table: operation.tableName,
        recordId: operation.recordId,
        error: error.message,
        data: operation.data,
      });
      throw error;
    }
  };

  // Sync all pending operations
  const syncPendingOperations = useCallback(async () => {
    if (syncingRef.current || !isOnline) {
      console.log('[SyncQueue] Sync skipped - syncing:', syncingRef.current, 'online:', isOnline);
      return;
    }
    
    syncingRef.current = true;
    setSyncStatus(prev => ({ ...prev, isSyncing: true, lastError: null }));
    
    console.log('[SyncQueue] Starting sync...');
    
    try {
      const pendingOps = await offlineDb.getPendingOperations();
      console.log('[SyncQueue] Pending operations:', pendingOps.length);
      
      if (pendingOps.length === 0) {
        setSyncStatus(prev => ({ 
          ...prev, 
          isSyncing: false, 
          pendingCount: 0,
          lastSyncAt: Date.now() 
        }));
        syncingRef.current = false;
        return;
      }
      
      let successCount = 0;
      let failedCount = 0;
      
      // Process operations in order (FIFO)
      for (const op of pendingOps) {
        if (!isOnline) break; // Stop if we go offline
        
        try {
          const success = await processOperation(op);
          
          if (success && op.id !== undefined) {
            await offlineDb.markOperationSynced(op.id);
            successCount++;
          }
        } catch (error: any) {
          failedCount++;
          if (op.id !== undefined) {
            await offlineDb.updateOperationError(op.id, error.message || 'Unknown error');
          }
          
          // If too many retries, skip but don't delete
          if (op.retryCount >= 5) {
            console.error('[SyncQueue] Max retries reached for operation:', op);
          }
        }
      }
      
      // Cleanup old synced operations
      await offlineDb.cleanupSyncedOperations();
      
      // Reload pending count
      await loadPendingCount();
      
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncAt: Date.now(),
        failedOperations: failedCount,
      }));
      
      if (successCount > 0) {
        toast({
          title: "Changes Synced ✓",
          description: `${successCount} change${successCount > 1 ? 's' : ''} synced successfully`,
        });
      }
      
      if (failedCount > 0) {
        toast({
          title: "Some Changes Failed",
          description: `${failedCount} change${failedCount > 1 ? 's' : ''} couldn't be synced. Will retry.`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('[SyncQueue] Sync error:', error);
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastError: error.message || 'Sync failed',
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [isOnline, loadPendingCount, toast]);

  // Manual retry
  const retrySyncFailedOperations = useCallback(async () => {
    await syncPendingOperations();
  }, [syncPendingOperations]);

  // Clear failed operations
  const clearFailedOperations = useCallback(async () => {
    const count = await offlineDb.clearFailedOperations();
    await loadPendingCount();
    
    if (count > 0) {
      toast({
        title: "Cleared Failed Operations",
        description: `${count} failed operation${count > 1 ? 's' : ''} removed`,
      });
    }
    
    return count;
  }, [loadPendingCount, toast]);

  // Delete a single operation
  const deleteOperation = useCallback(async (operationId: number) => {
    await offlineDb.deleteOperation(operationId);
    await loadPendingCount();
  }, [loadPendingCount]);

  // Get detailed pending operations list
  const getPendingOperationsList = useCallback(async () => {
    return offlineDb.getPendingOperations();
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && syncStatus.pendingCount > 0 && !syncingRef.current) {
      // Small delay to let connection stabilize
      retryTimeoutRef.current = window.setTimeout(() => {
        syncPendingOperations();
      }, 2000);
    }
    
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [isOnline, syncStatus.pendingCount, syncPendingOperations]);

  return {
    syncStatus,
    queueOperation,
    syncPendingOperations,
    retrySyncFailedOperations,
    clearFailedOperations,
    deleteOperation,
    getPendingOperationsList,
    loadPendingCount,
  };
}

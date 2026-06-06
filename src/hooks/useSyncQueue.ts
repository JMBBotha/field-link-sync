import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { offlineDb, PendingOperation, OperationType } from '@/lib/offlineDb';
import { useToast } from '@/hooks/use-toast';
import { ConflictInfo } from '@/components/SyncConflictDialog';

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
  
  const [activeConflict, setActiveConflict] = useState<ConflictInfo | null>(null);
  const conflictResolveRef = useRef<((choice: "keep_local" | "use_server") => void) | null>(null);

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
      console.log('[Offline][Queue] Adding operation:', { operationType, tableName, recordId, online: isOnline });
      await offlineDb.queueOperation({
        operationType,
        tableName,
        recordId,
        data,
        timestamp: Date.now(),
      });
      
      await loadPendingCount();
      console.log('[Offline][Queue] Operation queued successfully');
      
      // If online, try to sync immediately
      if (isOnline && !syncingRef.current) {
        console.log('[Offline][Queue] Online - triggering immediate sync');
        syncPendingOperations();
      }
    } catch (error) {
      console.error('[Offline][Queue] Error queuing operation:', error);
    }
  }, [isOnline, loadPendingCount]);

  // Check for conflicts using updated_at version comparison
  const checkForConflict = async (
    operation: PendingOperation
  ): Promise<{ hasConflict: boolean; serverData?: any; serverUpdatedAt?: string }> => {
    try {
      if (operation.tableName !== 'leads') {
        return { hasConflict: false };
      }

      // Fetch current server state including created_at as version proxy
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', operation.recordId)
        .maybeSingle();
      
      if (error || !data) {
        console.log('[Conflict][Check] Record not found or error, skipping conflict check:', operation.recordId?.slice(0, 8));
        return { hasConflict: false };
      }

      // Compare: if the server record was modified after the operation was queued, there's a conflict
      // We use created_at as a baseline; for true versioning we check if key fields differ
      const localData = operation.data || {};
      const conflictingFields: string[] = [];

      // Check if server fields differ from what the agent expected
      for (const key of Object.keys(localData)) {
        if (['cachedAt', '_isNotification'].includes(key)) continue;
        if (data[key as keyof typeof data] !== undefined) {
          const serverVal = JSON.stringify(data[key as keyof typeof data]);
          const localVal = JSON.stringify(localData[key]);
          if (serverVal !== localVal && serverVal !== undefined) {
            conflictingFields.push(key);
          }
        }
      }

      if (conflictingFields.length === 0) {
        console.log('[Conflict][Check] No field conflicts for:', operation.recordId?.slice(0, 8));
        return { hasConflict: false };
      }

      // Check if server was updated after our operation was queued
      // Use created_at + status changes as a proxy for updated_at
      const serverCreatedAt = new Date(data.created_at || 0).getTime();
      const serverStartedAt = data.started_at ? new Date(data.started_at).getTime() : 0;
      const serverCompletedAt = data.completed_at ? new Date(data.completed_at).getTime() : 0;
      const serverLatestAction = Math.max(serverCreatedAt, serverStartedAt, serverCompletedAt);

      if (serverLatestAction > operation.timestamp) {
        console.warn('[Conflict][Check] VERSION CONFLICT detected:', {
          recordId: operation.recordId?.slice(0, 8),
          conflictingFields,
          opTime: new Date(operation.timestamp).toISOString(),
          serverLatest: new Date(serverLatestAction).toISOString(),
          serverStatus: data.status,
          localStatus: localData.status,
        });
        return { 
          hasConflict: true, 
          serverData: data,
          serverUpdatedAt: new Date(serverLatestAction).toISOString(),
        };
      }

      console.log('[Conflict][Check] Fields differ but local is newer, proceeding:', operation.recordId?.slice(0, 8));
      return { hasConflict: false };
    } catch (err) {
      console.error('[Conflict][Check] Error during check:', err);
      return { hasConflict: false };
    }
  };

  // Wait for agent to resolve a conflict, or auto-resolve after timeout
  const waitForConflictResolution = (
    operation: PendingOperation,
    serverData: any,
    serverUpdatedAt: string
  ): Promise<"keep_local" | "use_server"> => {
    return new Promise((resolve) => {
      console.log('[Conflict][UI] Showing conflict dialog for:', operation.recordId?.slice(0, 8));

      setActiveConflict({
        operationId: operation.id!,
        recordId: operation.recordId,
        tableName: operation.tableName,
        localData: operation.data,
        serverData,
        serverUpdatedAt,
        localTimestamp: operation.timestamp,
      });

      conflictResolveRef.current = resolve;

      // Auto-resolve timeout (30s) as fallback
      setTimeout(() => {
        if (conflictResolveRef.current === resolve) {
          console.log('[Conflict][UI] Auto-resolving via timeout (last-write-wins)');
          conflictResolveRef.current = null;
          setActiveConflict(null);
          resolve("keep_local");
        }
      }, 30_000);
    });
  };

  // Called by the SyncConflictDialog
  const resolveConflict = useCallback((operationId: number, choice: "keep_local" | "use_server") => {
    console.log('[Conflict][Resolve] Agent chose:', choice, 'for op:', operationId);
    setActiveConflict(null);
    if (conflictResolveRef.current) {
      conflictResolveRef.current(choice);
      conflictResolveRef.current = null;
    }
  }, []);

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
      console.log('[Offline][Sync] Processing operation:', { id: operation.id, type: operation.operationType, recordId: operation.recordId, retryCount: operation.retryCount });
      // Check for conflicts on lead updates
      if (operation.operationType === 'update_lead' || operation.operationType === 'update_job_status') {
        const { hasConflict, serverData, serverUpdatedAt } = await checkForConflict(operation);
        
        if (hasConflict && serverData && serverUpdatedAt) {
          console.log('[Conflict][Sync] Conflict detected, awaiting resolution...');
          
          // Log conflict to Supabase
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from('sync_conflicts').insert({
              lead_id: operation.recordId,
              agent_id: user.id,
              conflict_type: 'version_mismatch',
              local_data: operation.data,
              server_data: serverData,
              resolution: 'pending',
            }).then(({ error }) => {
              if (error) console.error('[Conflict] Failed to log conflict:', error);
            });
          }

          const choice = await waitForConflictResolution(operation, serverData, serverUpdatedAt);
          console.log('[Conflict][Sync] Resolution:', choice, 'for record:', operation.recordId?.slice(0, 8));

          // Update conflict log with resolution
          if (user) {
            await supabase.from('sync_conflicts')
              .update({ resolution: choice === 'keep_local' ? 'keep_local' : 'use_server', resolved_at: new Date().toISOString() })
              .eq('lead_id', operation.recordId)
              .eq('agent_id', user.id)
              .eq('resolution', 'pending');
          }

          if (choice === 'use_server') {
            // Discard local changes - update local cache with server data
            console.log('[Conflict][Sync] Discarding local, using server version');
            await offlineDb.updateLeadLocally(operation.recordId, { ...serverData, cachedAt: Date.now() });
            return true; // Mark as synced without pushing to server
          }
          // choice === 'keep_local' — fall through to normal processing (override server)
          console.log('[Conflict][Sync] Keeping local changes, overriding server');
        }
      }

      switch (operation.operationType) {
        case 'update_lead':
        case 'update_job_status': {
          // Check if this is a queued notification (offline notification)
          if (operation.data?._isNotification && operation.tableName === 'notification_queue') {
            console.log('[Offline][Sync] Processing queued notification:', operation.data.notification_type);
            const { _isNotification, ...notifPayload } = operation.data;
            const { data, error } = await supabase.functions.invoke("send-whatsapp-notification", {
              body: notifPayload,
            });
            if (error) throw error;
            console.log('[Offline][Sync] Queued notification sent:', data);
            break;
          }

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
      console.error('[Offline][Sync] Operation FAILED:', {
        type: operation.operationType,
        table: operation.tableName,
        recordId: operation.recordId,
        error: error.message,
        retryCount: operation.retryCount,
      });
      throw error;
    }
  }, []);

  // Sync all pending operations
  const syncPendingOperations = useCallback(async () => {
    if (syncingRef.current || !isOnline) {
      console.log('[Offline][Sync] Skipped - syncing:', syncingRef.current, 'online:', isOnline);
      return;
    }
    
    syncingRef.current = true;
    setSyncStatus(prev => ({ ...prev, isSyncing: true, lastError: null }));
    
    console.log('[Offline][Sync] Starting sync...');
    
    try {
      const pendingOps = await offlineDb.getPendingOperations();
      console.log('[Offline][Sync] Pending operations:', pendingOps.length, pendingOps.map(o => `${o.operationType}:${o.recordId?.slice(0,8)}`));
      
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
            console.error('[Offline][Sync] Max retries (5) reached, giving up on:', op.operationType, op.recordId);
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
      
      console.log('[Offline][Sync] Complete:', { successCount, failedCount });
      
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
      console.error('[Offline][Sync] Fatal sync error:', error);
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastError: error.message || 'Sync failed',
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [isOnline, loadPendingCount, processOperation]);

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
    let timeoutId: number | undefined;
    if (isOnline && syncStatus.pendingCount > 0 && !syncingRef.current) {
      // Small delay to let connection stabilize
      timeoutId = window.setTimeout(() => {
        syncPendingOperations();
      }, 2000);
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
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
    activeConflict,
    resolveConflict,
  };
}

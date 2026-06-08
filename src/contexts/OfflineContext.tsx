import { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue, SyncStatus } from '@/hooks/useSyncQueue';
import { useToast } from '@/hooks/use-toast';
import { PendingOperation } from '@/lib/offlineDb';
import { ConflictInfo } from '@/components/SyncConflictDialog';

interface OfflineContextValue {
  isOnline: boolean;
  wasOffline: boolean;
  syncStatus: SyncStatus;
  queueOperation: (type: string, table: string, id: string, data: Record<string, unknown>) => Promise<void>;
  syncPendingOperations: () => Promise<void>;
  retrySyncFailedOperations: () => Promise<void>;
  clearFailedOperations: () => Promise<void>;
  deleteOperation: (id: number) => Promise<void>;
  getPendingOperationsList: () => Promise<PendingOperation[]>;
  acknowledgeReconnection: () => void;
  activeConflict: ConflictInfo | null;
  resolveConflict: (operationId: number, choice: 'keep_local' | 'use_server') => void;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const onlineStatus = useOnlineStatus();
  const syncQueue = useSyncQueue(onlineStatus.isOnline);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!onlineStatus.isOnline) {
      toast({
        title: "You're Offline",
        description: "Changes will be saved and synced when you reconnect",
        duration: 5000,
      });
    }
  }, [onlineStatus.isOnline, toast]);

  useEffect(() => {
    if (onlineStatus.wasOffline && onlineStatus.isOnline) {
      toast({
        title: "Back Online",
        description: "Syncing your offline changes...",
        duration: 3000,
      });
    }
  }, [onlineStatus.wasOffline, onlineStatus.isOnline, toast]);

  return (
    <OfflineContext.Provider
      value={{
        isOnline: onlineStatus.isOnline,
        wasOffline: onlineStatus.wasOffline,
        syncStatus: syncQueue.syncStatus,
        queueOperation: syncQueue.queueOperation,
        syncPendingOperations: syncQueue.syncPendingOperations,
        retrySyncFailedOperations: syncQueue.retrySyncFailedOperations,
        clearFailedOperations: syncQueue.clearFailedOperations,
        deleteOperation: syncQueue.deleteOperation,
        getPendingOperationsList: syncQueue.getPendingOperationsList,
        acknowledgeReconnection: onlineStatus.acknowledgeReconnection,
        activeConflict: syncQueue.activeConflict,
        resolveConflict: syncQueue.resolveConflict,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOfflineContext() {
  const context = useContext(OfflineContext);
  if (!context) throw new Error('useOfflineContext must be used within an OfflineProvider');
  return context;
}

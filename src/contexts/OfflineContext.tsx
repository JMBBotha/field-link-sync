import { createContext, useContext, ReactNode, useEffect } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue, SyncStatus } from '@/hooks/useSyncQueue';
import { useToast } from '@/hooks/use-toast';
import { PendingOperation } from '@/lib/offlineDb';

interface OfflineContextValue {
  isOnline: boolean;
  wasOffline: boolean;
  syncStatus: SyncStatus;
  queueOperation: (type: string, table: string, id: string, data: any) => Promise<void>;
  syncPendingOperations: () => Promise<void>;
  retrySyncFailedOperations: () => Promise<void>;
  clearFailedOperations: () => Promise<number>;
  deleteOperation: (id: number) => Promise<void>;
  getPendingOperationsList: () => Promise<PendingOperation[]>;
  acknowledgeReconnection: () => void;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const onlineStatus = useOnlineStatus();
  const syncQueue = useSyncQueue(onlineStatus.isOnline);

  // Show toast when going offline
  useEffect(() => {
    if (!onlineStatus.isOnline) {
      toast({
        title: "You're Offline",
        description: "Changes will be saved and synced when you reconnect",
        duration: 5000,
      });
    }
  }, [onlineStatus.isOnline, toast]);

  // Show toast when coming back online
  useEffect(() => {
    if (onlineStatus.wasOffline && onlineStatus.isOnline) {
      toast({
        title: "Back Online! 🌐",
        description: syncQueue.syncStatus.pendingCount > 0 
          ? `Syncing ${syncQueue.syncStatus.pendingCount} pending change${syncQueue.syncStatus.pendingCount > 1 ? 's' : ''}...`
          : "All changes synced",
      });
      onlineStatus.acknowledgeReconnection();
    }
  }, [onlineStatus.wasOffline, onlineStatus.isOnline, syncQueue.syncStatus.pendingCount, toast]);

  const value: OfflineContextValue = {
    isOnline: onlineStatus.isOnline,
    wasOffline: onlineStatus.wasOffline,
    syncStatus: syncQueue.syncStatus,
    queueOperation: syncQueue.queueOperation as any,
    syncPendingOperations: syncQueue.syncPendingOperations,
    retrySyncFailedOperations: syncQueue.retrySyncFailedOperations,
    clearFailedOperations: syncQueue.clearFailedOperations,
    deleteOperation: syncQueue.deleteOperation,
    getPendingOperationsList: syncQueue.getPendingOperationsList,
    acknowledgeReconnection: onlineStatus.acknowledgeReconnection,
  };

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
}

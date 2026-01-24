/**
 * Utility functions for testing offline functionality
 * These helpers make it easy to simulate network conditions and inspect queue state
 */

import { offlineDb } from '@/lib/offlineDb';

/**
 * Simulate going offline
 * Dispatches the 'offline' event to trigger offline mode
 */
export const simulateOffline = () => {
  console.log('[OfflineTest] Simulating offline mode...');
  window.dispatchEvent(new Event('offline'));
};

/**
 * Simulate coming back online
 * Dispatches the 'online' event to trigger sync
 */
export const simulateOnline = () => {
  console.log('[OfflineTest] Simulating online mode...');
  window.dispatchEvent(new Event('online'));
};

/**
 * Toggle network status
 * Convenient for quick testing
 */
export const toggleNetworkStatus = (goOffline: boolean) => {
  if (goOffline) {
    simulateOffline();
  } else {
    simulateOnline();
  }
};

/**
 * Log the current state of the sync queue
 * Useful for debugging pending operations
 */
export const logQueueState = async () => {
  try {
    const pending = await offlineDb.getPendingOperations();
    const byType = await offlineDb.getPendingOperationsByType();
    
    console.group('[OfflineTest] Queue State');
    console.log('Total pending:', pending.length);
    console.log('By type:', byType);
    console.table(pending.map(op => ({
      id: op.id,
      type: op.operationType,
      table: op.tableName,
      recordId: op.recordId?.substring(0, 8) + '...',
      timestamp: new Date(op.timestamp).toLocaleTimeString(),
      retryCount: op.retryCount,
      synced: op.synced,
      error: op.lastError?.substring(0, 30),
    })));
    console.groupEnd();
    
    return pending;
  } catch (error) {
    console.error('[OfflineTest] Failed to log queue state:', error);
    return [];
  }
};

/**
 * Log cached data summary
 */
export const logCacheState = async () => {
  try {
    const leads = await offlineDb.getCachedLeads();
    const customers = await offlineDb.getCachedCustomers();
    const equipment = await offlineDb.getCachedEquipment();
    const photos = await offlineDb.getPendingPhotos();
    const lastSync = await offlineDb.getLastSyncTime();
    
    console.group('[OfflineTest] Cache State');
    console.log('Cached leads:', leads.length);
    console.log('Cached customers:', customers.length);
    console.log('Cached equipment:', equipment.length);
    console.log('Pending photos:', photos.length);
    console.log('Last sync:', lastSync ? new Date(lastSync).toLocaleString() : 'Never');
    console.groupEnd();
    
    return { leads, customers, equipment, photos, lastSync };
  } catch (error) {
    console.error('[OfflineTest] Failed to log cache state:', error);
    return null;
  }
};

/**
 * Clear all offline data
 * Use with caution - removes all cached and pending data
 */
export const clearAllOfflineData = async () => {
  try {
    console.log('[OfflineTest] Clearing all offline data...');
    await offlineDb.clearEverything();
    console.log('[OfflineTest] All offline data cleared');
    return true;
  } catch (error) {
    console.error('[OfflineTest] Failed to clear offline data:', error);
    return false;
  }
};

/**
 * Add a test operation to the queue
 * Useful for testing sync behavior
 */
export const addTestOperation = async (leadId: string, data: any) => {
  try {
    await offlineDb.queueOperation({
      operationType: 'update_lead',
      tableName: 'leads',
      recordId: leadId,
      data,
      timestamp: Date.now(),
    });
    console.log('[OfflineTest] Test operation added to queue');
    return true;
  } catch (error) {
    console.error('[OfflineTest] Failed to add test operation:', error);
    return false;
  }
};

/**
 * Simulate a complete offline workflow
 * 1. Go offline
 * 2. Wait for specified duration
 * 3. Come back online
 */
export const simulateOfflinePeriod = async (durationMs: number = 5000) => {
  console.log(`[OfflineTest] Starting offline simulation for ${durationMs}ms`);
  
  simulateOffline();
  
  await new Promise(resolve => setTimeout(resolve, durationMs));
  
  simulateOnline();
  
  console.log('[OfflineTest] Offline simulation complete');
};

/**
 * Check if browser reports online status
 */
export const checkBrowserOnlineStatus = () => {
  const status = {
    navigatorOnLine: navigator.onLine,
    connectionType: (navigator as any).connection?.effectiveType || 'unknown',
    downlink: (navigator as any).connection?.downlink || 'unknown',
    rtt: (navigator as any).connection?.rtt || 'unknown',
  };
  
  console.log('[OfflineTest] Browser network status:', status);
  return status;
};

// Expose utilities to window for console access during development
if (typeof window !== 'undefined') {
  (window as any).offlineTest = {
    simulateOffline,
    simulateOnline,
    toggleNetworkStatus,
    logQueueState,
    logCacheState,
    clearAllOfflineData,
    addTestOperation,
    simulateOfflinePeriod,
    checkBrowserOnlineStatus,
  };
  
  console.log('[OfflineTest] Test utilities available at window.offlineTest');
}

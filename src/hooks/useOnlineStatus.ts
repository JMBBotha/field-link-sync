import { useState, useEffect, useCallback } from 'react';

export interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean; // True if we just came back online
  lastOnlineAt: number | null;
  lastOfflineAt: number | null;
}

export function useOnlineStatus() {
  const [status, setStatus] = useState<OnlineStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    wasOffline: false,
    lastOnlineAt: null,
    lastOfflineAt: null,
  });

  const handleOnline = useCallback(() => {
    setStatus(prev => ({
      isOnline: true,
      wasOffline: !prev.isOnline, // True if we were offline before
      lastOnlineAt: Date.now(),
      lastOfflineAt: prev.lastOfflineAt,
    }));
  }, []);

  const handleOffline = useCallback(() => {
    setStatus(prev => ({
      isOnline: false,
      wasOffline: false,
      lastOnlineAt: prev.lastOnlineAt,
      lastOfflineAt: Date.now(),
    }));
  }, []);

  // Reset wasOffline flag after it's been acknowledged
  const acknowledgeReconnection = useCallback(() => {
    setStatus(prev => ({
      ...prev,
      wasOffline: false,
    }));
  }, []);

  useEffect(() => {
    // Set initial state
    if (navigator.onLine) {
      setStatus(prev => ({ ...prev, lastOnlineAt: Date.now() }));
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also check connection quality periodically
    const checkConnection = async () => {
      try {
        // Try a small fetch to verify actual connectivity
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        await fetch('/favicon.ico', {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // If we get here, we're truly online
        if (!status.isOnline) {
          handleOnline();
        }
      } catch {
        // Could be offline or request failed
        // Only mark offline if navigator says offline too
        if (!navigator.onLine && status.isOnline) {
          handleOffline();
        }
      }
    };

    // Check connection every 30 seconds
    const intervalId = setInterval(checkConnection, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalId);
    };
  }, [handleOnline, handleOffline, status.isOnline]);

  return {
    ...status,
    acknowledgeReconnection,
  };
}

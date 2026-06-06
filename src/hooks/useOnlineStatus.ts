import { useState, useEffect, useCallback, useRef } from 'react';

export interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
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

  const isOnlineRef = useRef(status.isOnline);
  isOnlineRef.current = status.isOnline;

  const checkingRef = useRef(false);

  const handleOnline = useCallback(() => {
    setStatus(prev => ({
      isOnline: true,
      wasOffline: !prev.isOnline,
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

  const acknowledgeReconnection = useCallback(() => {
    setStatus(prev => ({
      ...prev,
      wasOffline: false,
    }));
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const checkConnection = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;

      try {
        const response = await fetch('/', { cache: 'no-cache' });
        if (response.ok && !isOnlineRef.current) {
          handleOnline();
        }
      } catch (err) {
        if (isOnlineRef.current) {
          handleOffline();
        }
      } finally {
        checkingRef.current = false;
      }
    };

    const interval = setInterval(checkConnection, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [handleOnline, handleOffline]);

  return { ...status, acknowledgeReconnection };
}

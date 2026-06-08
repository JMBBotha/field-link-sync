import { useState, useEffect, useCallback, useRef } from "react";
import { offlineDb } from "@/lib/offlineDb";

interface UseJobTimerResult {
  elapsedTime: string;
  elapsedMs: number;
}

// Format elapsed time as "Xh Ym" or "Xm" if under 1 hour
export const formatElapsedTime = (startedAt: string | null | undefined): string => {
  if (!startedAt) return "";
  
  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - startTime;
  
  if (diffMs < 0) return "";
  
  const diffMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${diffMins}m`;
};

// Hook for live updating job timer with offline persistence
export const useJobTimer = (startedAt: string | null | undefined, leadId?: string): UseJobTimerResult => {
  const [elapsedTime, setElapsedTime] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const intervalRef = useRef<number | null>(null);
  const persistIntervalRef = useRef<number | null>(null);

  const updateTimer = useCallback(() => {
    if (!startedAt) {
      setElapsedTime("");
      setElapsedMs(0);
      return;
    }

    const startTime = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - startTime;

    if (diffMs < 0) {
      setElapsedTime("");
      setElapsedMs(0);
      return;
    }

    setElapsedMs(diffMs);
    
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    if (hours > 0) {
      setElapsedTime(`${hours}h ${mins}m`);
    } else {
      setElapsedTime(`${diffMins}m`);
    }
  }, [startedAt]);

  // Persist timer state to IndexedDB every 30 seconds
  useEffect(() => {
    if (!startedAt || !leadId) return;

    const persistTimer = async () => {
      try {
        const now = Date.now();
        const startTime = new Date(startedAt).getTime();
        await offlineDb.saveTimerLog({
          id: `timer-${leadId}`,
          leadId,
          startedAt: startTime,
          pausedAt: null,
          totalElapsedMs: now - startTime,
          lastUpdatedAt: now,
          synced: false,
        });
        console.log('[Offline][Timer] Persisted timer for lead:', leadId);
      } catch (error) {
        console.error('[Offline][Timer] Failed to persist timer:', error);
      }
    };

    // Persist immediately and then every 30 seconds
    persistTimer();
    persistIntervalRef.current = window.setInterval(persistTimer, 30000);

    return () => {
      if (persistIntervalRef.current) {
        clearInterval(persistIntervalRef.current);
      }
    };
  }, [startedAt, leadId]);

  // Restore timer from IndexedDB on mount
  useEffect(() => {
    if (startedAt || !leadId) return;
    let cancelled = false;

    const restoreTimer = async () => {
      try {
        const saved = await offlineDb.getTimerLogForLead(leadId);
        if (cancelled) return;
        if (saved && !saved.synced) {
          const diffMs = saved.totalElapsedMs;
          if (diffMs > 0) {
            setElapsedMs(diffMs);
            const diffMins = Math.floor(diffMs / 60000);
            const hours = Math.floor(diffMins / 60);
            const mins = diffMins % 60;
            setElapsedTime(hours > 0 ? `${hours}h ${mins}m` : `${diffMins}m`);
            console.log('[Offline][Timer] Restored timer for lead:', leadId, 'elapsed:', diffMs);
          }
        }
      } catch (error) {
        console.error('[Offline][Timer] Failed to restore timer:', error);
      }
    };

    void restoreTimer();
    return () => { cancelled = true; };
  }, [leadId, startedAt]);

  useEffect(() => {
    updateTimer();
    
    if (startedAt) {
      intervalRef.current = window.setInterval(updateTimer, 60000); // Update every minute
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [startedAt, updateTimer]);

  return { elapsedTime, elapsedMs };
};

export default useJobTimer;
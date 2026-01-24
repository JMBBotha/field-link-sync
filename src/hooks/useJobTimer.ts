import { useState, useEffect, useCallback, useRef } from "react";

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

// Hook for live updating job timer
export const useJobTimer = (startedAt: string | null | undefined): UseJobTimerResult => {
  const [elapsedTime, setElapsedTime] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const intervalRef = useRef<number | null>(null);

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
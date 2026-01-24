import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type AvailabilityStatus = "available" | "busy" | "offline";

interface UseAvailabilityResult {
  status: AvailabilityStatus;
  nextAvailableTime: Date | null;
  isInBufferWindow: boolean;
  setManualStatus: (status: AvailabilityStatus) => Promise<void>;
  startJob: (estimatedDurationMinutes: number) => Promise<Date>;
  extendJob: (additionalMinutes: number) => Promise<Date>;
  completeJob: () => Promise<void>;
  formatNextAvailable: () => string;
}

const BUFFER_MINUTES = 45; // Auto-available 45 minutes before estimated end

export const useAvailability = (userId: string | undefined): UseAvailabilityResult => {
  const [status, setStatus] = useState<AvailabilityStatus>("available");
  const [nextAvailableTime, setNextAvailableTime] = useState<Date | null>(null);
  const [isInBufferWindow, setIsInBufferWindow] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const { toast } = useToast();
  const bufferCheckInterval = useRef<number | null>(null);

  // Check if we're in the buffer window (45 min before estimated end)
  const checkBufferWindow = useCallback(() => {
    if (!nextAvailableTime || manualOverride) return;

    const now = new Date();
    const bufferStart = new Date(nextAvailableTime.getTime() - BUFFER_MINUTES * 60 * 1000);
    
    if (now >= bufferStart && status === "busy") {
      setIsInBufferWindow(true);
      
      // Only show toast once when entering buffer
      if (!isInBufferWindow) {
        toast({
          title: "Almost Available! ⏰",
          description: "You'll be available for new leads in 45 minutes",
        });
      }
    }
  }, [nextAvailableTime, status, manualOverride, isInBufferWindow, toast]);

  // Start interval to check buffer window
  useEffect(() => {
    if (status === "busy" && nextAvailableTime) {
      bufferCheckInterval.current = window.setInterval(checkBufferWindow, 60000);
      checkBufferWindow(); // Check immediately
    }

    return () => {
      if (bufferCheckInterval.current) {
        clearInterval(bufferCheckInterval.current);
      }
    };
  }, [status, nextAvailableTime, checkBufferWindow]);

  // Update profile availability status
  const updateProfileStatus = useCallback(async (newStatus: AvailabilityStatus) => {
    if (!userId) return;

    await supabase
      .from("profiles")
      .update({
        availability_status: newStatus,
        last_availability_update: new Date().toISOString(),
      })
      .eq("id", userId);

    // Also update agent_locations
    await supabase
      .from("agent_locations")
      .update({
        is_available: newStatus === "available" || isInBufferWindow,
        last_updated: new Date().toISOString(),
      })
      .eq("agent_id", userId);
  }, [userId, isInBufferWindow]);

  // Manual status toggle
  const setManualStatus = useCallback(async (newStatus: AvailabilityStatus) => {
    setManualOverride(true);
    setStatus(newStatus);
    setIsInBufferWindow(false);
    
    if (newStatus === "available") {
      setNextAvailableTime(null);
    }
    
    await updateProfileStatus(newStatus);
  }, [updateProfileStatus]);

  // Start job with duration
  const startJob = useCallback(async (estimatedDurationMinutes: number): Promise<Date> => {
    const now = new Date();
    const estimatedEnd = new Date(now.getTime() + estimatedDurationMinutes * 60 * 1000);
    
    setStatus("busy");
    setNextAvailableTime(estimatedEnd);
    setIsInBufferWindow(false);
    setManualOverride(false);
    
    await updateProfileStatus("busy");
    
    return estimatedEnd;
  }, [updateProfileStatus]);

  // Extend job time
  const extendJob = useCallback(async (additionalMinutes: number): Promise<Date> => {
    const currentEnd = nextAvailableTime || new Date();
    const newEnd = new Date(currentEnd.getTime() + additionalMinutes * 60 * 1000);
    
    setNextAvailableTime(newEnd);
    setIsInBufferWindow(false);
    
    return newEnd;
  }, [nextAvailableTime]);

  // Complete job
  const completeJob = useCallback(async () => {
    setStatus("available");
    setNextAvailableTime(null);
    setIsInBufferWindow(false);
    setManualOverride(false);
    
    await updateProfileStatus("available");
    
    toast({
      title: "You're Available! ✅",
      description: "Ready to receive new leads",
    });
  }, [updateProfileStatus, toast]);

  // Format next available time for display
  const formatNextAvailable = useCallback((): string => {
    if (!nextAvailableTime) return "Available now";
    
    const now = new Date();
    const diff = nextAvailableTime.getTime() - now.getTime();
    
    if (diff <= 0) return "Available now";
    
    const diffMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    
    if (hours > 0) {
      return `Next available ~ ${hours}h ${mins}m`;
    }
    return `Next available ~ ${mins}m`;
  }, [nextAvailableTime]);

  // Load initial status from profile
  useEffect(() => {
    const loadStatus = async () => {
      if (!userId) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("availability_status")
        .eq("id", userId)
        .maybeSingle();

      if (profile?.availability_status) {
        setStatus(profile.availability_status as AvailabilityStatus);
      }

      // Check for active in_progress lead to set next available time
      const { data: activeLead } = await supabase
        .from("leads")
        .select("estimated_end_time, actual_start_time, estimated_duration_minutes")
        .eq("assigned_agent_id", userId)
        .eq("status", "in_progress")
        .maybeSingle();

      if (activeLead?.estimated_end_time) {
        setNextAvailableTime(new Date(activeLead.estimated_end_time));
        setStatus("busy");
      }
    };

    loadStatus();
  }, [userId]);

  return {
    status,
    nextAvailableTime,
    isInBufferWindow,
    setManualStatus,
    startJob,
    extendJob,
    completeJob,
    formatNextAvailable,
  };
};

export default useAvailability;

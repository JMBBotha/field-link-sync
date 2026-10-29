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
  const [status, setStatus] = useState<AvailabilityStatus>("offline");
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

  // Single source of truth: profiles.availability_status via set_my_availability.
  // A DB trigger mirrors it onto agent_locations.is_available.
  const updateProfileStatus = useCallback(async (newStatus: AvailabilityStatus | "restore", manual = true): Promise<AvailabilityStatus | null> => {
    if (!userId) return null;
    const { data, error } = await (supabase.rpc as any)("set_my_availability", { p_status: newStatus, p_manual: manual });
    if (error) {
      console.error("[useAvailability] set_my_availability failed", error);
      toast({ title: "Couldn't update availability", description: error.message, variant: "destructive" });
      return null;
    }
    return (data as AvailabilityStatus) ?? null;
  }, [userId, toast]);

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
    
    await updateProfileStatus("busy", false);
    
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
    setNextAvailableTime(null);
    setIsInBufferWindow(false);
    setManualOverride(false);

    // Go back to whatever the person last chose (Available / Busy / Off).
    const restored = (await updateProfileStatus("restore", false)) ?? "available";
    setStatus(restored);

    toast({
      title: restored === "available" ? "You're Available! ✅" : restored === "busy" ? "Job done — still Busy" : "Job done — you're Off",
      description: restored === "available" ? "Ready to receive new leads" : "Back to your previous availability",
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
    let cancelled = false;
    const loadStatus = async () => {
      if (!userId) return;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("availability_status")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;
      if (profileError) {
        console.error("[useAvailability] load profile failed", profileError);
      }

      if (profile?.availability_status) {
        setStatus(profile.availability_status as AvailabilityStatus);
      }

      // Check for active in_progress lead to set next available time
      const { data: activeLead, error: leadError } = await supabase
        .from("leads")
        .select("estimated_end_time, actual_start_time, estimated_duration_minutes")
        .eq("assigned_agent_id", userId)
        .eq("status", "in_progress")
        .maybeSingle();

      if (cancelled) return;
      if (leadError) {
        console.error("[useAvailability] load active lead failed", leadError);
      }

      if (activeLead?.estimated_end_time) {
        setNextAvailableTime(new Date(activeLead.estimated_end_time));
        setStatus("busy");
      }
    };

    loadStatus().catch((err) => console.error("[useAvailability] loadStatus error", err));

    return () => {
      cancelled = true;
    };
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

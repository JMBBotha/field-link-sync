import { useState, useCallback } from 'react';
import { offlineDb } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { shareLocationIfAllowed } from '@/lib/locationPing';
import { useToast } from '@/hooks/use-toast';

interface UseOfflineAvailabilityResult {
  isAvailable: boolean;
  loading: boolean;
  toggleAvailability: (
    agentId: string,
    available: boolean,
    location: { lat: number; lng: number } | null,
    isOnline: boolean,
    queueOperation: (type: string, table: string, id: string, data: Record<string, unknown>) => Promise<void>
  ) => Promise<void>;
  loadAvailability: (agentId: string) => Promise<boolean | null>;
}

export function useOfflineAvailability(): UseOfflineAvailabilityResult {
  const [isAvailable, setIsAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Load availability status for an agent
  const loadAvailability = useCallback(async (agentId: string): Promise<boolean | null> => {
    try {
      // First try to get from server
      const { data, error } = await supabase
        .from('agent_locations')
        .select('is_available')
        .eq('agent_id', agentId)
        .single();

      if (!error && data) {
        setIsAvailable(data.is_available ?? true);
        return data.is_available ?? true;
      }

      // Fall back to local cache
      const cached = await offlineDb.getLatestAvailability(agentId);
      if (cached) {
        setIsAvailable(cached.isAvailable);
        return cached.isAvailable;
      }

      return null;
    } catch (error) {
      console.error('Failed to load availability:', error);
      return null;
    }
  }, []);

  // Toggle availability with offline support
  const toggleAvailability = useCallback(async (
    agentId: string,
    available: boolean,
    location: { lat: number; lng: number } | null,
    isOnline: boolean,
    queueOperation: (type: string, table: string, id: string, data: Record<string, unknown>) => Promise<void>
  ) => {
    setLoading(true);

    try {
      // Update local state immediately (optimistic update)
      setIsAvailable(available);
      void queueOperation;

      // Save to local cache. Coordinates are not queued for a later upsert.
      await offlineDb.saveAvailability({
        id: agentId,
        agentId,
        isAvailable: available,
        latitude: location?.lat || 0,
        longitude: location?.lng || 0,
        updatedAt: Date.now(),
        synced: false,
      });

      // If online and they are actually sharing, a ping may go out. Turning Off
      // must not write a new coordinate (that would keep the map pin fresh).
      if (isOnline && available && location) {
        await shareLocationIfAllowed(location.lat, location.lng);
        await offlineDb.markAvailabilitySynced(agentId);
      }

      toast({
        title: available ? "You're Available! ✅" : "You're Offline",
        description: available
          ? "You'll see new available leads"
          : "You won't see new leads, but can work on active jobs",
      });
    } catch (error: unknown) {
      console.error('Failed to toggle availability:', error);

      // Revert optimistic update
      setIsAvailable(!available);

      toast({
        title: "Error",
        description: "Failed to update availability. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    isAvailable,
    loading,
    toggleAvailability,
    loadAvailability,
  };
}

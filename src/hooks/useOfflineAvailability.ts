import { useState, useCallback, useEffect } from 'react';
import { offlineDb, OfflineAvailability } from '@/lib/offlineDb';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface UseOfflineAvailabilityResult {
  isAvailable: boolean;
  loading: boolean;
  toggleAvailability: (
    agentId: string,
    available: boolean,
    location: { lat: number; lng: number } | null,
    isOnline: boolean,
    queueOperation: (type: string, table: string, id: string, data: any) => Promise<void>
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
    queueOperation: (type: string, table: string, id: string, data: any) => Promise<void>
  ) => {
    setLoading(true);
    
    try {
      // Update local state immediately (optimistic update)
      setIsAvailable(available);

      // Prepare data
      const availabilityData = {
        is_available: available,
        latitude: location?.lat || 0,
        longitude: location?.lng || 0,
        last_updated: new Date().toISOString(),
      };

      // Save to local cache
      await offlineDb.saveAvailability({
        id: agentId,
        agentId,
        isAvailable: available,
        latitude: location?.lat || 0,
        longitude: location?.lng || 0,
        updatedAt: Date.now(),
        synced: false,
      });

      // If online, try to sync immediately
      if (isOnline) {
        const { error } = await supabase
          .from('agent_locations')
          .upsert({
            agent_id: agentId,
            ...availabilityData,
          }, { onConflict: 'agent_id' });

        if (error) {
          throw error;
        }

        // Mark as synced
        await offlineDb.markAvailabilitySynced(agentId);
      } else {
        // Queue for later sync
        await queueOperation(
          'update_agent_location',
          'agent_locations',
          agentId,
          availabilityData
        );
      }

      toast({
        title: available ? "You're Available! ✅" : "You're Offline",
        description: available
          ? "You'll see new available leads"
          : "You won't see new leads, but can work on active jobs",
      });
    } catch (error: any) {
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

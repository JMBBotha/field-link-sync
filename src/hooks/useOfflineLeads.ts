import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { offlineDb, OfflineLead } from '@/lib/offlineDb';
import { useToast } from '@/hooks/use-toast';

export interface OfflineLeadsState {
  leads: OfflineLead[];
  loading: boolean;
  isFromCache: boolean;
  lastFetchedAt: number | null;
}

export function useOfflineLeads(
  userId: string | undefined,
  isOnline: boolean,
  queueOperation: (type: string, table: string, id: string, data: any) => Promise<void>
) {
  const { toast } = useToast();
  const [state, setState] = useState<OfflineLeadsState>({
    leads: [],
    loading: true,
    isFromCache: false,
    lastFetchedAt: null,
  });
  
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch leads from Supabase and cache them
  const fetchAndCacheLeads = useCallback(async () => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .or(`and(status.in.(open,pending,released),assigned_agent_id.is.null),assigned_agent_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const leads = data || [];
      
      // Cache to IndexedDB
      await offlineDb.cacheLeads(leads, userId);
      
      // Also cache related customers if available
      const customerIds = [...new Set(leads.map(l => l.customer_id).filter(Boolean))];
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('*')
          .in('id', customerIds as string[]);
        
        if (customers) {
          await offlineDb.cacheCustomers(customers);
        }
      }

      // Cache related equipment
      const equipmentIds = [...new Set(leads.map(l => l.equipment_id).filter(Boolean))];
      if (equipmentIds.length > 0) {
        const { data: equipment } = await supabase
          .from('equipment')
          .select('*')
          .in('id', equipmentIds as string[]);
        
        if (equipment) {
          await offlineDb.cacheEquipment(equipment);
        }
      }

      setState({
        leads: leads.map(l => ({ ...l, cachedAt: Date.now() })),
        loading: false,
        isFromCache: false,
        lastFetchedAt: Date.now(),
      });
    } catch (error: any) {
      console.error('[OfflineLeads] Fetch error:', error);
      
      // Try to load from cache
      await loadFromCache();
    }
  }, [userId]);

  // Load leads from IndexedDB cache
  const loadFromCache = useCallback(async () => {
    try {
      const cachedLeads = await offlineDb.getCachedLeads();
      const lastSync = await offlineDb.getLastSyncTime();
      
      setState({
        leads: cachedLeads,
        loading: false,
        isFromCache: true,
        lastFetchedAt: lastSync,
      });
      
      if (cachedLeads.length > 0) {
        toast({
          title: "Offline Mode",
          description: `Showing ${cachedLeads.length} cached lead${cachedLeads.length > 1 ? 's' : ''}`,
        });
      }
    } catch (error) {
      console.error('[OfflineLeads] Cache load error:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [toast]);

  // Update lead locally (optimistic update) and queue sync
  const updateLeadOptimistic = useCallback(async (
    leadId: string,
    updates: Partial<OfflineLead>
  ) => {
    // Update local state immediately
    setState(prev => ({
      ...prev,
      leads: prev.leads.map(lead =>
        lead.id === leadId ? { ...lead, ...updates, cachedAt: Date.now() } : lead
      ),
    }));

    // Update IndexedDB cache
    await offlineDb.updateLeadLocally(leadId, updates);

    // Queue for sync if offline, or sync immediately if online
    await queueOperation('update_lead', 'leads', leadId, updates);
  }, [queueOperation]);

  // Accept a lead
  const acceptLead = useCallback(async (leadId: string) => {
    if (!userId) return false;

    const updates = {
      assigned_agent_id: userId,
      status: 'claimed',
      accepted_at: new Date().toISOString(),
    };

    await updateLeadOptimistic(leadId, updates);
    return true;
  }, [userId, updateLeadOptimistic]);

  // Start a job
  const startJob = useCallback(async (leadId: string) => {
    const updates = {
      status: 'in_progress',
      started_at: new Date().toISOString(),
    };

    await updateLeadOptimistic(leadId, updates);
    return true;
  }, [updateLeadOptimistic]);

  // Complete a job
  const completeJob = useCallback(async (leadId: string) => {
    const updates = {
      status: 'completed',
      completed_at: new Date().toISOString(),
    };

    await updateLeadOptimistic(leadId, updates);
    return true;
  }, [updateLeadOptimistic]);

  // Release a lead
  const releaseLead = useCallback(async (leadId: string) => {
    const updates = {
      status: 'open',
      assigned_agent_id: null,
      accepted_at: null,
    };

    await updateLeadOptimistic(leadId, updates as any);
    return true;
  }, [updateLeadOptimistic]);

  // Subscribe to real-time updates when online
  const subscribeToLeads = useCallback(() => {
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    subscriptionRef.current = supabase
      .channel('offline-leads-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
        },
        () => {
          // Refresh data when changes occur
          if (isOnline) {
            fetchAndCacheLeads();
          }
        }
      )
      .subscribe();

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [isOnline, fetchAndCacheLeads]);

  // Initial load
  useEffect(() => {
    if (!userId) return;

    if (isOnline) {
      fetchAndCacheLeads();
      subscribeToLeads();
    } else {
      loadFromCache();
    }

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [userId, isOnline]);

  // Refetch when coming back online
  useEffect(() => {
    if (isOnline && userId && state.isFromCache) {
      fetchAndCacheLeads();
    }
  }, [isOnline, userId, state.isFromCache, fetchAndCacheLeads]);

  return {
    ...state,
    refetch: fetchAndCacheLeads,
    acceptLead,
    startJob,
    completeJob,
    releaseLead,
    updateLeadOptimistic,
  };
}

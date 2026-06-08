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
  queueOperation: (type: string, table: string, id: string, data: any) => Promise<any>
) {
  const { toast } = useToast();
  const [state, setState] = useState<OfflineLeadsState>({
    leads: [],
    loading: true,
    isFromCache: false,
    lastFetchedAt: null,
  });

  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchAndCacheLeads = useCallback(async () => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .or(`and(status.in.(pending),assigned_agent_id.is.null),assigned_agent_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const leads = data || [];

      await offlineDb.cacheLeads(leads, userId);

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
      await loadFromCache();
    }
  }, [userId]);

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

  const updateLeadOptimistic = useCallback(async (
    leadId: string,
    updates: Partial<OfflineLead>
  ) => {
    setState(prev => ({
      ...prev,
      leads: prev.leads.map(lead => lead.id === leadId ? { ...lead, ...updates, cachedAt: Date.now() } : lead),
    }));

    await offlineDb.updateLeadLocally(leadId, updates);
    await queueOperation('update_lead', 'leads', leadId, updates);
  }, [queueOperation]);

  const acceptLead = useCallback(async (leadId: string) => {
    if (!userId) return false;

    const updates = {
      assigned_agent_id: userId,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    };
    await updateLeadOptimistic(leadId, updates);

    if (isOnline) {
      const { data, error } = await supabase.rpc('accept_lead' as any, {
        p_lead_id: leadId,
        p_agent_id: userId,
      });

      if (error) {
        console.error('accept_lead RPC error:', error);
        fetchAndCacheLeads().catch(() => {});
        throw new Error((data as any)?.error || error.message || 'Failed to accept lead');
      }

      if (data && !(data as any).success) {
        fetchAndCacheLeads().catch(() => {});
        throw new Error((data as any)?.error || 'Lead already taken');
      }
    }
    return true;
  }, [userId, updateLeadOptimistic, isOnline, fetchAndCacheLeads]);

  const startJob = useCallback(async (leadId: string) => {
    const updates = {
      status: 'in_progress',
      started_at: new Date().toISOString(),
    };
    await updateLeadOptimistic(leadId, updates);
    return true;
  }, [updateLeadOptimistic]);

  const completeJob = useCallback(async (leadId: string) => {
    const updates = {
      status: 'completed',
      completed_at: new Date().toISOString(),
    };
    await updateLeadOptimistic(leadId, updates);
    return true;
  }, [updateLeadOptimistic]);

  const releaseLead = useCallback(async (leadId: string, reason?: string) => {
    if (!userId) return false;

    const updates = {
      status: 'pending',
      assigned_agent_id: null,
      accepted_at: null,
    };
    await updateLeadOptimistic(leadId, updates as any);

    if (isOnline) {
      const { error } = await supabase.rpc('release_lead' as any, {
        p_lead_id: leadId,
        p_agent_id: userId,
        p_reason: reason || 'No reason provided',
      });

      if (error) {
        console.error('release_lead RPC error:', error);
      }
    }
    return true;
  }, [userId, updateLeadOptimistic, isOnline]);

  const subscribeToLeads = useCallback(() => {
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    subscriptionRef.current = supabase.channel('offline-leads-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        () => {
          if (isOnline) {
            fetchAndCacheLeads().catch(() => {});
          }
        }
      )
      .subscribe();
  }, [isOnline, fetchAndCacheLeads]);

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
        subscriptionRef.current = null;
      }
    };
  }, [userId, isOnline, fetchAndCacheLeads, subscribeToLeads, loadFromCache]);

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

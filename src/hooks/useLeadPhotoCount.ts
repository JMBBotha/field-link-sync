import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PhotoCounts {
  [leadId: string]: number;
}

export function useLeadPhotoCount(leadIds: string[]) {
  const [photoCounts, setPhotoCounts] = useState<PhotoCounts>({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    if (leadIds.length === 0) {
      setPhotoCounts({});
      setLoading(false);
      return;
    }

    try {
      // Fetch photo counts for all lead IDs
      const { data, error } = await supabase
        .from('job_photos')
        .select('lead_id')
        .in('lead_id', leadIds);

      if (error) {
        console.error('Error fetching photo counts:', error);
        setLoading(false);
        return;
      }

      // Count photos per lead
      const counts: PhotoCounts = {};
      leadIds.forEach(id => counts[id] = 0);
      
      if (data) {
        data.forEach(photo => {
          if (photo.lead_id) {
            counts[photo.lead_id] = (counts[photo.lead_id] || 0) + 1;
          }
        });
      }

      setPhotoCounts(counts);
    } catch (error) {
      console.error('Error fetching photo counts:', error);
    } finally {
      setLoading(false);
    }
  }, [leadIds.join(',')]); // Use join to create stable dependency

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Subscribe to photo changes
  useEffect(() => {
    if (leadIds.length === 0) return;

    const channel = supabase
      .channel('photo-count-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_photos',
        },
        () => {
          fetchCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchCounts]);

  return { photoCounts, loading, refetch: fetchCounts };
}

// Single lead photo count hook for individual components
export function useSingleLeadPhotoCount(leadId: string | undefined) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    if (!leadId) {
      setCount(0);
      setLoading(false);
      return;
    }

    try {
      const { count: photoCount, error } = await supabase
        .from('job_photos')
        .select('*', { count: 'exact', head: true })
        .eq('lead_id', leadId);

      if (error) {
        console.error('Error fetching photo count:', error);
      } else {
        setCount(photoCount || 0);
      }
    } catch (error) {
      console.error('Error fetching photo count:', error);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Subscribe to photo changes for this lead
  useEffect(() => {
    if (!leadId) return;

    const channel = supabase
      .channel(`photo-count-${leadId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_photos',
          filter: `lead_id=eq.${leadId}`,
        },
        () => {
          fetchCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, fetchCount]);

  return { count, loading, refetch: fetchCount };
}

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CompletedJobsFilters {
  agentIds: string[] | null;
  startDate: string | null;
  endDate: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  search: string | null;
}

const defaultFilters: CompletedJobsFilters = {
  agentIds: null,
  startDate: null,
  endDate: null,
  centerLat: null,
  centerLng: null,
  radiusKm: null,
  search: null,
};

export interface CompletedJob {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  priority?: string;
  customer_id?: string | null;
  equipment_id?: string | null;
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
}

export function useCompletedJobsFilter() {
  const [filters, setFilters] = useState<CompletedJobsFilters>(defaultFilters);
  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFiltered, setIsFiltered] = useState(false);

  const hasActiveFilters = useCallback(() => {
    return (
      (filters.agentIds !== null && filters.agentIds.length > 0) ||
      filters.startDate !== null ||
      filters.endDate !== null ||
      filters.centerLat !== null ||
      filters.search !== null
    );
  }, [filters]);

  const fetchFilteredJobs = useCallback(async (filtersToApply: CompletedJobsFilters) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_completed_jobs", {
        p_agent_ids: filtersToApply.agentIds?.length ? filtersToApply.agentIds : null,
        p_start_date: filtersToApply.startDate || null,
        p_end_date: filtersToApply.endDate || null,
        p_center_lat: filtersToApply.centerLat ?? null,
        p_center_lng: filtersToApply.centerLng ?? null,
        p_radius_km: filtersToApply.radiusKm ?? null,
        p_search: filtersToApply.search || null,
      });

      if (error) {
        console.error("[CompletedJobsFilter] RPC error:", error);
        return;
      }

      setJobs((data as CompletedJob[]) || []);
      setIsFiltered(true);
    } catch (err) {
      console.error("[CompletedJobsFilter] Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyFilters = useCallback((newFilters: CompletedJobsFilters) => {
    setFilters(newFilters);
    fetchFilteredJobs(newFilters);
  }, [fetchFilteredJobs]);

  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
    setIsFiltered(false);
    setJobs([]);
  }, []);

  return {
    filters,
    setFilters,
    jobs,
    loading,
    isFiltered,
    hasActiveFilters,
    applyFilters,
    clearFilters,
  };
}

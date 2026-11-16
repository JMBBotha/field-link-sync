import type { DefaultOptions } from "@tanstack/react-query";

/**
 * Visited screens keep their last result for the working session (gcTime) and
 * are allowed to be 30s old before a quiet refetch. A mutation still calls
 * invalidateQueries, which refetches immediately — money screens do not wait
 * out the 30s. Screens that must refresh on every visit set staleTime: 0
 * themselves; isLoading stays false while that cached result is showing.
 */
export const queryDefaults: DefaultOptions = {
  queries: {
    retry: (failureCount, error) => {
      const status = (error as { status?: number } | null)?.status;
      if (status != null && status >= 400 && status < 500) return false;
      return failureCount < 2;
    },
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
  },
  mutations: {
    retry: false,
  },
};

/** Show the cached rows at once, and ask the server again on this visit. */
export const refreshOnVisit = { staleTime: 0 } as const;

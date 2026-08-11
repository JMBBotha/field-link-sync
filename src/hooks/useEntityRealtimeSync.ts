import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ENTITY_REGISTRY, type EntityType } from "@/lib/entityRegistry";
import { entityQueryKey, patchEntityCaches } from "@/hooks/useEntityEditor";

/**
 * App-wide realtime sync for every editable entity (jobs, leads, clients,
 * projects).
 *
 * - UPDATE  -> patch the single-entity cache AND every list/board/calendar
 *              cache that holds a copy of the row, so open popups and lists
 *              in other tabs/users update in place with no refetch flash.
 * - INSERT/DELETE -> invalidate the list caches so new/removed rows appear.
 *
 * Per-popup subscriptions in `useEntityEditor` remain as a fast path; this hook
 * covers views that have no popup open.
 */
export function useEntityRealtimeSync() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;

    const types = Object.keys(ENTITY_REGISTRY) as EntityType[];

    const channels = types.map((type) => {
      const cfg = ENTITY_REGISTRY[type];

      const invalidateLists = () =>
        cfg.cacheKeys.forEach((root) => qc.invalidateQueries({ queryKey: [root] }));

      return supabase
        .channel(`entity-sync-${cfg.table}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: cfg.table },
          (payload) => {
            const row = payload.new as Record<string, any> | null;
            if (!row?.id) return;
            const key = entityQueryKey(type, row.id);
            if (qc.getQueryData(key) !== undefined) qc.setQueryData(key, row);
            patchEntityCaches(qc, type, row.id, row);
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: cfg.table },
          invalidateLists,
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: cfg.table },
          (payload) => {
            const id = (payload.old as Record<string, any> | null)?.id;
            if (id) qc.removeQueries({ queryKey: entityQueryKey(type, id) });
            invalidateLists();
          },
        )
        .subscribe();
    });

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [qc, userId]);
}

/** Mount once inside the QueryClientProvider. */
export function EntityRealtimeSync() {
  useEntityRealtimeSync();
  return null;
}

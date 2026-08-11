import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getEntityConfig, type EntityType } from "@/lib/entityRegistry";

type Row = Record<string, any>;

/**
 * Recursively patch any cached shape that can contain this entity:
 * a single row, an array of rows, or an object whose values hold rows
 * (e.g. schedules joined with `leads`).
 */
const patchValue = (value: any, id: string, patch: Row, depth = 0): any => {
  if (!value || depth > 3) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const patched = patchValue(item, id, patch, depth + 1);
      if (patched !== item) changed = true;
      return patched;
    });
    return changed ? next : value;
  }
  if (typeof value !== "object") return value;

  if (value.id === id) return { ...value, ...patch };

  let changed = false;
  const next: Row = { ...value };
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child && typeof child === "object") {
      const patched = patchValue(child, id, patch, depth + 1);
      if (patched !== child) {
        next[key] = patched;
        changed = true;
      }
    }
  }
  return changed ? next : value;
};

/** Patch every registered cache key for this entity type. Returns a rollback fn. */
export const patchEntityCaches = (
  qc: QueryClient,
  entityType: EntityType,
  id: string,
  patch: Row,
) => {
  const cfg = getEntityConfig(entityType);
  const snapshots: [readonly unknown[], any][] = [];

  cfg.cacheKeys.forEach((root) => {
    qc.getQueriesData({ queryKey: [root] }).forEach(([key, data]) => {
      const next = patchValue(data, id, patch);
      if (next !== data) {
        snapshots.push([key, data]);
        qc.setQueryData(key, next);
      }
    });
  });

  return () => snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
};

export const entityQueryKey = (entityType: EntityType, id?: string | null) => [
  entityType,
  id,
];

interface UseEntityEditorOptions {
  /** Seed data so the popup renders instantly from the row the board already has. */
  initialData?: Row | null;
  enabled?: boolean;
}

/**
 * Shared editor for a single entity. Every details popup uses this:
 * one query key, one mutation, optimistic updates across every cache that
 * shows the record, rollback on failure and realtime-backed freshness.
 */
export function useEntityEditor(
  entityType: EntityType,
  id: string | null | undefined,
  options: UseEntityEditorOptions = {},
) {
  const cfg = getEntityConfig(entityType);
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = useMemo(() => entityQueryKey(entityType, id), [entityType, id]);

  const query = useQuery({
    queryKey,
    enabled: !!id && options.enabled !== false,
    initialData: options.initialData ?? undefined,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(cfg.table as any)
        .select(cfg.select)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as Row | null;
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: Row) => {
      const { data, error } = await (supabase as any).rpc("update_entity", {
        p_entity_type: entityType,
        p_entity_id: id,
        p_patch: patch,
      });
      if (error) throw error;
      return data as Row;
    },
    onMutate: async (patch: Row) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData(queryKey);
      qc.setQueryData(queryKey, (prev: Row | undefined) =>
        prev ? { ...prev, ...patch } : prev,
      );
      const rollbackLists = patchEntityCaches(qc, entityType, id!, patch);
      return { previous, rollbackLists };
    },
    onError: (err: any, _patch, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(queryKey, ctx.previous);
      ctx?.rollbackLists?.();
      toast({
        title: "Couldn't save change",
        description: err?.message || "Reverted.",
        variant: "destructive",
      });
    },
    onSuccess: (row) => {
      if (row) {
        qc.setQueryData(queryKey, row);
        patchEntityCaches(qc, entityType, id!, row);
      }
    },
    onSettled: () => {
      cfg.cacheKeys.forEach((root) =>
        qc.invalidateQueries({ queryKey: [root], refetchType: "none" }),
      );
    },
  });

  const updateField = useCallback(
    (key: string, value: any) => mutation.mutateAsync({ [key]: value }),
    [mutation],
  );

  // Realtime: keep every open popup / tab / user in sync without a global store.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`entity-${entityType}-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: cfg.table, filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Row;
          if (!row) return;
          qc.setQueryData(queryKey, row);
          patchEntityCaches(qc, entityType, id, row);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [entityType, id, cfg.table, qc, queryKey]);

  return {
    config: cfg,
    data: (query.data ?? options.initialData ?? null) as Row | null,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    savingField: mutation.isPending ? Object.keys(mutation.variables ?? {})[0] : null,
    update: mutation.mutateAsync,
    updateField,
  };
}

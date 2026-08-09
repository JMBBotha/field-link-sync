import { useCallback, useState } from "react";
import {
  logEntityResolution,
  resolveEntity,
  type EntityCandidate,
  type EntityResolution,
  type EntityType,
  type ResolveOptions,
} from "@/lib/entityResolution";

interface PendingAsk {
  resolution: EntityResolution;
  resolve: (value: EntityCandidate | null) => void;
}

/**
 * Fuzzy entity resolution with a built-in "Did you mean…?" step.
 *
 * `resolve()` returns the confirmed record, or null if the user cancelled or
 * nothing matched. High-confidence reads resolve immediately; anything
 * ambiguous — and every risky/write action — waits for the user.
 */
export function useEntityResolver(channel: "text" | "voice" = "text") {
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const [loading, setLoading] = useState(false);

  const resolve = useCallback(
    async (
      entityType: EntityType,
      query: string,
      opts: ResolveOptions = {},
    ): Promise<EntityCandidate | null> => {
      setLoading(true);
      let resolution: EntityResolution;
      try {
        resolution = await resolveEntity(entityType, query, opts);
      } finally {
        setLoading(false);
      }

      if (resolution.decision === "auto" && resolution.chosen) {
        await logEntityResolution(resolution, resolution.chosen, "auto", channel);
        return resolution.chosen;
      }

      if (resolution.decision === "retry") {
        await logEntityResolution(resolution, null, "retry", channel);
      }

      return new Promise<EntityCandidate | null>((done) => {
        setPending({ resolution, resolve: done });
      });
    },
    [channel],
  );

  const confirm = useCallback(
    async (candidate: EntityCandidate) => {
      if (!pending) return;
      await logEntityResolution(pending.resolution, candidate, "confirmed", channel);
      pending.resolve(candidate);
      setPending(null);
    },
    [pending, channel],
  );

  const cancel = useCallback(async () => {
    if (!pending) return;
    await logEntityResolution(pending.resolution, null, "cancelled", channel);
    pending.resolve(null);
    setPending(null);
  }, [pending, channel]);

  /** Close the prompt so the caller can ask again with a new/spelled query. */
  const retry = useCallback(() => {
    if (!pending) return;
    pending.resolve(null);
    setPending(null);
  }, [pending]);

  return {
    resolve,
    loading,
    pendingResolution: pending?.resolution ?? null,
    confirm,
    cancel,
    retry,
  };
}

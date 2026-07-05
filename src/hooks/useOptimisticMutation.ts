import { QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type Patcher<TVars> = (prev: any, vars: TVars) => any;

/**
 * Small wrapper around useMutation for the common optimistic pattern:
 *   1. cancel affected queries
 *   2. snapshot + patch cache
 *   3. run mutation
 *   4. on error → revert snapshot + toast
 *   5. on settled → invalidate to reconcile with server
 *
 * Meant for high-frequency actions (status changes, quick inserts) where
 * the UI must feel instant on mobile.
 */
export function useOptimisticMutation<TVars, TResult = unknown>(opts: {
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** Query keys that need the same optimistic patch applied. */
  keys: (vars: TVars) => QueryKey[];
  /** Return the new cache value for a given key's previous value. */
  patch: Patcher<TVars>;
  /** Query keys to invalidate after the mutation settles. Defaults to `keys`. */
  invalidateKeys?: (vars: TVars) => QueryKey[];
  onSuccessMessage?: string | ((r: TResult, v: TVars) => string | undefined);
  errorMessage?: string;
  onSuccess?: (r: TResult, v: TVars) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      const keys = opts.keys(vars);
      await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));
      const snapshots = keys.map((k) => [k, qc.getQueryData(k)] as const);
      keys.forEach(([k]: any, i) => {
        const key = keys[i];
        qc.setQueryData(key, (prev: any) => opts.patch(prev, vars));
      });
      return { snapshots };
    },
    onError: (err: any, _vars, ctx) => {
      ctx?.snapshots?.forEach(([k, v]) => qc.setQueryData(k, v));
      toast({
        title: opts.errorMessage || "Couldn't update",
        description: err?.message || "Reverted. Please try again.",
        variant: "destructive",
      });
    },
    onSuccess: (result, vars) => {
      const msg =
        typeof opts.onSuccessMessage === "function"
          ? opts.onSuccessMessage(result, vars)
          : opts.onSuccessMessage;
      if (msg) toast({ title: msg });
      opts.onSuccess?.(result, vars);
    },
    onSettled: (_r, _e, vars) => {
      const keys = (opts.invalidateKeys || opts.keys)(vars);
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

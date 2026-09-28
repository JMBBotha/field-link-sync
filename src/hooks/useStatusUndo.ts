import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  readStack, recordStatusChange, dropEntry, peekEntry, isStale, buildRevertPatch, buildRevertLog,
  tableFor, UNDO_EVENT, type StatusUndoEntry,
} from "@/lib/statusUndo";

export type UndoResult = "undone" | "stale" | "error";

/** Session undo stack for the signed-in user + revert (stale-checked, logged). */
export function useStatusUndo() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const [stack, setStack] = useState<StatusUndoEntry[]>(() => readStack(userId));

  useEffect(() => {
    const sync = () => setStack(readStack(userId));
    sync();
    window.addEventListener(UNDO_EVENT, sync);
    return () => window.removeEventListener(UNDO_EVENT, sync);
  }, [userId]);

  const record = useCallback(
    (e: Omit<StatusUndoEntry, "id" | "at">) => recordStatusChange(userId, e),
    [userId],
  );

  const revert = useCallback(async (e: StatusUndoEntry): Promise<{ result: UndoResult; message?: string }> => {
    if (!userId) return { result: "error", message: "Not signed in" };
    const table = tableFor(e.entity_type) as any;
    const { data, error } = await (supabase.from(table) as any).select(`${e.field}, company_id`).eq("id", e.entity_id).maybeSingle();
    if (error || !data) { dropEntry(userId, e.id); return { result: "error", message: error?.message || "Not found" }; }
    if (isStale(data[e.field] as string | null, e)) { dropEntry(userId, e.id); return { result: "stale" }; }
    const { error: upErr } = await (supabase.from(table) as any).update(buildRevertPatch(e)).eq("id", e.entity_id);
    if (upErr) return { result: "error", message: upErr.message };
    const log = buildRevertLog({ ...e, company_id: e.company_id ?? data.company_id }, userId);
    if (log) await (supabase.from("status_change_log") as any).insert(log);
    dropEntry(userId, e.id);
    ["jobs", "jobs-dispatch", "job-detail", "quotes", "quote-document", "dispatch-leads"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    return { result: "undone" };
  }, [userId, qc]);

  return { stack, last: peekEntry(stack), record, revert };
}

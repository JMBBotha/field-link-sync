import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tool, ToolEvent, ToolType } from "@/lib/companyTools";

/** Company tools register. RLS: admin/owner see the company's tools; techs only their own. Writes go through RPCs. */
export const sbt = supabase as any;
export const TOOL_BUCKET = "tool-invoices";
const COLS = "id, company_id, label, name, tool_type_id, supplier_name, purchase_date, cost_cents, cost_tbc, invoice_path, assigned_tech_id, assigned_tech_name, status, status_date, retired_date, notes, purchase_batch_id, created_at";

export function useCompanyId() {
  return useQuery({ queryKey: ["my-company-id"], queryFn: async () => (await sbt.rpc("caller_company_id")).data as string | null });
}
export function useCanEditTools(companyId: string | null | undefined) {
  return useQuery({ queryKey: ["tools-admin", companyId], enabled: !!companyId,
    queryFn: async () => { const { data, error } = await sbt.rpc("_tools_admin", { p_company: companyId }); return !error && data === true; } });
}
export function useToolTypes() {
  return useQuery({ queryKey: ["tool-types"], queryFn: async () => ((await sbt.from("tool_types").select("id, company_id, name").order("name")).data ?? []) as ToolType[] });
}
export function useTools(opts: { mine?: string } = {}) {
  return useQuery({ queryKey: ["tools", opts.mine ?? "all"], queryFn: async () => {
    let q = sbt.from("tools").select(COLS).order("label");
    if (opts.mine) q = q.eq("assigned_tech_id", opts.mine);
    const { data, error } = await q; if (error) throw error; return (data ?? []) as Tool[];
  } });
}
export function useToolEvents(toolId: string | null) {
  return useQuery({ queryKey: ["tool-events", toolId], enabled: !!toolId,
    queryFn: async () => ((await sbt.from("tool_events").select("*").eq("tool_id", toolId).order("event_date", { ascending: false })).data ?? []) as ToolEvent[] });
}
export function useTechs(companyId: string | null | undefined) {
  return useQuery({ queryKey: ["tool-techs", companyId], enabled: !!companyId, queryFn: async () => {
    // Names only (POPIA): no phone/email pulled into the tools screens.
    const { data } = await sbt.from("profiles").select("id, full_name").eq("company_id", companyId).is("archived_at", null).order("full_name");
    return ((data ?? []) as { id: string; full_name: string | null }[]).filter((p) => p.full_name);
  } });
}
export function useToolsRefresh() {
  const qc = useQueryClient();
  return () => Promise.all(["tools", "tool-events", "tool-types"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await sbt.rpc(name, args); if (error) throw new Error(error.message); return data;
}
export async function uploadToolInvoice(companyId: string, toolIds: string[], file: File) {
  const path = `${companyId}/${toolIds.length > 1 ? "batch" : toolIds[0]}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await sbt.storage.from(TOOL_BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  for (const id of toolIds) await rpc("update_tool", { p_tool: id, p_patch: { invoice_path: path } });
  return path;
}
export async function openToolInvoice(path: string) {
  const { data, error } = await sbt.storage.from(TOOL_BUCKET).createSignedUrl(path, 300);
  if (error) throw new Error(error.message); window.open(data.signedUrl, "_blank", "noopener");
}

import { formatRand } from "@/utils/formatRand";
/** Company tools register: pure helpers (no Supabase). Tools are equipment, never stock, never on a job/invoice. */
export type ToolStatus = "in_store" | "in_use" | "broken" | "lost" | "retired";
export interface ToolType { id: string; company_id: string | null; name: string }
export interface Tool {
  id: string; company_id: string; label: string; name: string; tool_type_id: string; supplier_name: string | null; purchase_date: string | null;
  cost_cents: number | null; cost_tbc: boolean; invoice_path: string | null; assigned_tech_id: string | null; assigned_tech_name: string | null;
  status: ToolStatus; status_date: string; retired_date: string | null; notes: string | null; purchase_batch_id: string | null; created_at: string;
}
export interface ToolEvent { id: string; tool_id: string; event: string; from_status: ToolStatus | null; to_status: ToolStatus | null; tech_name: string | null; done_by_name: string | null; event_date: string; note: string | null }

export const STATUS: Record<ToolStatus, { label: string; cls: string }> = {
  in_store: { label: "In store", cls: "bg-slate-200 text-slate-700" },
  in_use: { label: "In use", cls: "bg-sky-100 text-sky-800" },
  broken: { label: "Broken", cls: "bg-amber-100 text-amber-800" },
  lost: { label: "Lost", cls: "bg-red-100 text-red-700" },
  retired: { label: "Retired", cls: "bg-zinc-100 text-zinc-500" },
};
export const ENDED: ToolStatus[] = ["broken", "lost", "retired"];

export const rands = (cents: number | null | undefined) => (cents == null ? "—" : formatRand(cents / 100));
/** "R 916,67" or "TBC" / "R916.67 (TBC)" while the invoice is outstanding. */
export const costText = (t: Pick<Tool, "cost_cents" | "cost_tbc">) => (t.cost_cents == null ? (t.cost_tbc ? "TBC" : "—") : `${rands(t.cost_cents)}${t.cost_tbc ? " (TBC)" : ""}`);

/** Split a purchase total over n tools; cents remainder goes to the first tools so the parts add up exactly. */
export function splitCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n), rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}
/** Parse "R2 750,00" / "2750.5" → cents; empty → null. */
export function parseRands(s: string): number | null {
  const t = s.replace(/[R\s]/gi, "").replace(/,(\d{1,2})$/, ".$1").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
/** Next free labels for a prefix: existing FK-01, FK-02 → FK-03, FK-04 … (2-digit minimum). */
export function nextLabels(prefix: string, existing: string[], n: number): string[] {
  const p = prefix.trim().toUpperCase().replace(/-+$/, "");
  if (!p) return [];
  const used = new Set(existing.map((e) => e.toUpperCase()));
  const nums = existing.map((e) => e.toUpperCase().match(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`))).filter(Boolean).map((m) => Number(m![1]));
  let k = nums.length ? Math.max(...nums) : 0; const out: string[] = [];
  while (out.length < n) { k++; const l = `${p}-${String(k).padStart(2, "0")}`; if (!used.has(l)) out.push(l); }
  return out;
}
/** Short label prefix from a type name: "Flaring kit" → FK, "Vacuum pump" → VP, "Drill" → DR. */
export const prefixFor = (typeName: string) => {
  const w = typeName.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w.slice(0, 3).map((x) => x[0]).join("") : (w[0] ?? "T").slice(0, 2)).toUpperCase();
};
export const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
export const ageDays = (t: Pick<Tool, "purchase_date" | "status" | "status_date" | "retired_date">, today = new Date().toISOString().slice(0, 10)) =>
  t.purchase_date ? daysBetween(t.purchase_date, ENDED.includes(t.status) ? t.retired_date ?? t.status_date : today) : null;

export interface TypeSummary { type_id: string; name: string; owned: number; in_use: number; in_store: number; ended: number; avg_life_days: number | null; replaced_12m: number; spend_cents: number; tbc: number }
/** Same maths as the tool_type_stats view, done client-side so the cards also work for types with 0 tools. */
export function summarise(types: ToolType[], tools: Tool[], today = new Date().toISOString().slice(0, 10)): TypeSummary[] {
  return types.map((ty) => {
    const ts = tools.filter((t) => t.tool_type_id === ty.id);
    const ended = ts.filter((t) => ENDED.includes(t.status));
    const lives = ended.map((t) => ageDays(t, today)).filter((d): d is number => d != null);
    return { type_id: ty.id, name: ty.name, owned: ts.filter((t) => !ENDED.includes(t.status)).length, in_use: ts.filter((t) => t.status === "in_use").length,
      in_store: ts.filter((t) => t.status === "in_store").length, ended: ended.length, avg_life_days: lives.length ? Math.round(lives.reduce((a, b) => a + b, 0) / lives.length) : null,
      replaced_12m: ended.filter((t) => daysBetween(t.retired_date ?? t.status_date, today) <= 365).length,
      spend_cents: ts.reduce((a, t) => a + (t.cost_cents ?? 0), 0), tbc: ts.filter((t) => t.cost_tbc).length };
  });
}
/** Needs attention: broken, lost, or no invoice attached yet (not retired). */
export const needsAttention = (tools: Tool[]) => tools.filter((t) => t.status === "broken" || t.status === "lost" || (t.status !== "retired" && !t.invoice_path));

export interface ToolFilter { type?: string; status?: ToolStatus | "active" | "all"; tech?: string; q?: string }
export function filterTools(tools: Tool[], f: ToolFilter): Tool[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return tools.filter((t) => (!f.type || t.tool_type_id === f.type)
    && (f.status === "all" || (!f.status || f.status === "active" ? t.status !== "retired" : t.status === f.status))
    && (!f.tech || t.assigned_tech_id === f.tech)
    && (!q || `${t.label} ${t.name} ${t.supplier_name ?? ""} ${t.assigned_tech_name ?? ""}`.toLowerCase().includes(q)))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}
export const EVENT_TEXT: Record<string, string> = { added: "Added", issued: "Issued", returned: "Returned to store", status_changed: "Status changed", reported: "Reported", edited: "Edited", retired: "Retired" };
export function eventLine(e: ToolEvent): string {
  const to = e.to_status ? STATUS[e.to_status]?.label : "";
  const what = e.event === "issued" ? `Issued to ${e.tech_name ?? "tech"}` : e.event === "returned" ? `Returned by ${e.tech_name ?? "tech"}`
    : e.event === "reported" ? `Reported ${to.toLowerCase()}` : e.event === "status_changed" ? `Marked ${to.toLowerCase()}` : EVENT_TEXT[e.event] ?? e.event;
  return `${what}${e.done_by_name ? ` · by ${e.done_by_name}` : ""}${e.note ? ` · ${e.note}` : ""}`;
}
export const fmtDate = (d: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—");

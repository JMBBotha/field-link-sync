/** v8 Lead → Paid board columns, derived only from existing data and existing drop rules (dropAction). */
import type { Deal, PipelineStage, PipeInvoice } from "@/lib/quotePipeline";
import { dropAction } from "@/lib/quotePipeline";

export type V8Col = "lead" | "quote" | "accepted" | "booked" | "invoiced" | "paid" | "lost";
export const V8_COLS: { key: V8Col; label: string; hint: string }[] = [
  { key: "lead", label: "Lead", hint: "not quoted yet" },
  { key: "quote", label: "Quote sent", hint: "draft, sent or viewed" },
  { key: "accepted", label: "Accepted", hint: "deposit invoice · book the job" },
  { key: "booked", label: "Job booked", hint: "on Dispatch" },
  { key: "invoiced", label: "Invoiced", hint: "waiting for payment" },
  { key: "paid", label: "Paid", hint: "done" },
];

const VOID = new Set(["void", "cancelled", "draft"]);
export function v8ColOf(d: Deal, invoices: PipeInvoice[]): V8Col {
  if (d.stage === "lost") return "lost";
  if (d.stage === "draft" || d.stage === "sent" || d.stage === "viewed") return "quote";
  if (d.stage === "accepted") return "accepted";
  if (d.stage === "booked") {
    if (d.value > 0 && d.paid >= d.value - 0.5) return "paid";
    const live = invoices.some((i) => i.quote_id === d.quote.id && !VOID.has(String(i.status || "").toLowerCase()));
    return live ? "invoiced" : "booked";
  }
  return "quote";
}

/** What a drop onto a v8 column does — only the existing actions; Invoiced/Paid stay where the money is recorded. */
export function v8Drop(d: Deal, to: V8Col): { action: "send" | "accept" | "book" | "lose" | null; reason?: string } {
  if (to === "invoiced") return { action: null, reason: "Invoice from Money (Invoices) — the card moves here when the invoice is issued." };
  if (to === "paid") return { action: null, reason: "Record the payment on the invoice — the card moves here when it's paid." };
  if (to === "lead") return { action: null, reason: "Can't move a deal back." };
  const target: PipelineStage = to === "quote" ? "sent" : (to as PipelineStage);
  if (to === "quote" && d.stage !== "draft") return { action: null, reason: d.stage === "sent" || d.stage === "viewed" ? undefined : "Can't move a deal back." };
  const r = dropAction(d.stage, target);
  return { action: r.action as any, reason: r.reason };
}

/** Park + Lost reason live in the existing status_change_log (no new columns): field_name "v8_park" / "lost_reason". */
export const V8_PARK_FIELD = "v8_park";
export const V8_LOST_FIELD = "lost_reason";
export const V8_PARK_REASONS = ["Waiting for stock", "No answer", "Client asked to wait", "Other"];
export const V8_LOST_REASONS = ["Price too high", "Went with a competitor", "No answer", "Job cancelled", "Other"];
export type V8NoteRow = { entity_id: string; field_name: string; new_status: string | null; created_at: string };
/** Latest row per quote wins; an empty park value means un-parked. */
export function v8Notes(rows: V8NoteRow[]): { parked: Record<string, string>; lost: Record<string, string> } {
  const parked: Record<string, string> = {}; const lost: Record<string, string> = {};
  [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((r) => {
    const v = (r.new_status || "").trim();
    if (r.field_name === V8_PARK_FIELD) { if (v) parked[r.entity_id] = v; else delete parked[r.entity_id]; }
    if (r.field_name === V8_LOST_FIELD && v) lost[r.entity_id] = v;
  });
  return { parked, lost };
}
/** Only open deals (quote sent / accepted) can be parked; parking changes no status. */
export const v8CanPark = (col: V8Col) => col === "quote" || col === "accepted";

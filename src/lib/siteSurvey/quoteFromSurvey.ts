/**
 * P6 "Start quote from survey": a draft quote with one area per surveyed room and ONE line per room
 * (unit size · pipe run · wall · electrical · extra holes · access flags). No items, no prices: the rep picks units in the builder.
 */
import { supabase } from "@/integrations/supabase/client";
import { ROOM_FLAGS, btuLabel, overStandard, type SurveyDraft, type SurveyRoom } from "./model";

export function roomLine(r: SurveyRoom): string {
  const extra = overStandard(r.pipe_run_m);
  return [
    r.unit_size_btu ? `${btuLabel(r.unit_size_btu)} BTU` : null,
    r.pipe_run_m != null ? `${r.pipe_run_m} m pipe${extra > 0 ? ` (${extra} m over standard)` : ""}` : null,
    r.wall_type, r.electrical, r.floor_level && r.floor_level !== "Ground floor" ? r.floor_level : null,
    r.core_holes ? `${r.core_holes} extra hole${r.core_holes > 1 ? "s" : ""}` : null,
    ...ROOM_FLAGS.filter((f) => r.flags?.[f.key]).map((f) => f.label),
  ].filter(Boolean).join(" · ");
}

export function areasFromSurvey(d: SurveyDraft) {
  return d.rooms.map((r, i) => ({ name: r.name, description: roomLine(r) || null, sort_order: i }));
}

const sb = () => supabase as any;

/** Returns the quote id to open. Re-uses the survey's quote (adds rooms only if it has no areas yet). */
export async function startQuoteFromSurvey(d: SurveyDraft, userId: string): Promise<string> {
  const { data: lead, error: le } = await sb().from("leads").select("id, customer_id, customer_name, assigned_agent_id, company_id").eq("id", d.leadId).maybeSingle();
  if (le) throw le;
  if (!lead?.customer_id) throw new Error("No client linked to this lead yet. Link a client first.");
  let quoteId = d.quote_id;
  if (quoteId) {
    const { data: q } = await sb().from("quotes").select("id, status").eq("id", quoteId).maybeSingle();
    if (!q || !["draft"].includes(q.status)) quoteId = null;
  }
  if (!quoteId) {
    const { data, error } = await sb().from("quotes").insert({
      sales_engineer_id: lead.assigned_agent_id || userId, company_id: lead.company_id, status: "draft",
      subtotal: 0, vat_rate: 0.15, vat_amount: 0, total: 0, customer_id: lead.customer_id, lead_id: lead.id,
      ...(lead.customer_name ? { customer_name: lead.customer_name } : {}),
    }).select("id").single();
    if (error) throw error;
    quoteId = data.id as string;
  }
  const { count } = await sb().from("quote_areas").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
  if (!count) {
    const rows = areasFromSurvey(d).map((a) => ({ ...a, quote_id: quoteId }));
    if (rows.length) { const { error } = await sb().from("quote_areas").insert(rows); if (error) throw error; }
  }
  if (d.quote_id !== quoteId) await sb().from("site_surveys").update({ quote_id: quoteId }).eq("id", d.id);
  return quoteId!;
}

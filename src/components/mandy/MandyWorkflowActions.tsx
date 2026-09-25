/**
 * Global Mandy actions for invoices, deposits, schedule and map navigation.
 * Same queries (and RLS) as the pages/buttons; money documents go through a
 * confirm card built in depositActions.ts.
 */
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useRegisterMandyActions } from "@/lib/mandy/registry";
import { fetchQuoteInvoice, ensureDepositInvoiceForQuote } from "@/lib/depositInvoice";
import { makeDepositHandlers, type DepositQuote } from "@/lib/mandy/depositActions";
import { resolveSpokenDate, sastToday } from "@/lib/mandy/dates";
import { getAssistantContext } from "@/stores/assistantContextStore";
import { makeMapHandlers } from "@/lib/mandy/mapStatus";
import type { MandyResult } from "@/lib/mandy/actions";

const QUOTE_COLS = "id, quote_number, status, total, customer_name";

async function resolveQuote(quoteRef?: string) {
  const ref = (quoteRef || "").trim();
  if (!ref) {
    const id = getAssistantContext().open_quote_id;
    if (!id) return null;
    const { data } = await supabase.from("quotes").select(QUOTE_COLS).eq("id", id).maybeSingle();
    return (data as DepositQuote) || null;
  }
  const byNum = await supabase.from("quotes").select(QUOTE_COLS).ilike("quote_number", `%${ref}%`).order("created_at", { ascending: false }).limit(5);
  let rows = (byNum.data || []) as DepositQuote[];
  if (!rows.length) {
    const byName = await supabase.from("quotes").select(QUOTE_COLS).ilike("customer_name", `%${ref}%`).order("created_at", { ascending: false }).limit(5);
    rows = (byName.data || []) as DepositQuote[];
  }
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  return { choices: rows.map((q) => ({ label: `${q.quote_number || "Draft"}${q.customer_name ? ` · ${q.customer_name}` : ""}`, quote_ref: q.quote_number || q.id })) };
}

const suburb = (addr?: string | null) => {
  const parts = (addr || "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "";
};

export function useWorkflowMandyActions() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isFieldAgent, isAdmin, isDispatcher } = useRole();
  const fieldOnly = isFieldAgent && !isAdmin && !isDispatcher;

  const deposit = makeDepositHandlers({
    resolveQuote,
    fetchInvoice: fetchQuoteInvoice,
    depositPercent: async () => {
      // Same deterministic latest company setting the RPC uses (fallback 70%).
      const { data } = await (supabase.from("company_settings") as any)
        .select("default_deposit_percentage").order("updated_at", { ascending: false, nullsFirst: false }).order("id").limit(1).maybeSingle();
      const p = Number(data?.default_deposit_percentage) || 70;
      return p <= 0 || p > 100 ? 70 : p;
    },
    ensureDeposit: ensureDepositInvoiceForQuote,
    onCreated: (quoteId) => { void qc.invalidateQueries({ queryKey: ["accepted-work-invoice", quoteId] }); },
  });

  useRegisterMandyActions({
    open_invoice: async ({ ref, client, invoice_id }): Promise<MandyResult> => {
      const open = (inv: any): MandyResult => {
        navigate(`/admin/invoices/${inv.id}`);
        return { ok: true, message: `Opened invoice ${inv.invoice_number || ""}${inv.customer_name ? ` for ${inv.customer_name}` : ""}.`.replace("  ", " "), data: { invoice_id: inv.id } };
      };
      let q = supabase.from("invoices").select("id, invoice_number, customer_name, created_at").order("created_at", { ascending: false }).limit(6);
      if (invoice_id) q = q.eq("id", invoice_id);
      else if (ref) q = q.ilike("invoice_number", `%${String(ref).trim()}%`);
      else if (client) q = q.ilike("customer_name", `%${String(client).trim()}%`);
      else return { ok: false, message: "Say the invoice number or the client's name." };
      const { data, error } = await q;
      if (error) return { ok: false, message: `Could not load invoices: ${error.message}` };
      if (!data?.length) return { ok: false, message: `No invoice matching “${ref || client}”.` };
      if (data.length === 1) return open(data[0]);
      return {
        ok: true,
        message: "Several invoices match. Waiting for the user to tap one.",
        choices: data.map((i: any) => ({ label: `${i.invoice_number} · ${i.customer_name}`, action: "open_invoice", args: { invoice_id: i.id } })),
      };
    },

    show_deposit_due: deposit.show_deposit_due,
    create_deposit_invoice: deposit.create_deposit_invoice,

    open_calendar_day: async ({ date }): Promise<MandyResult> => {
      const d = resolveSpokenDate(String(date || ""));
      if (!d) return { ok: false, message: `I couldn't work out the date “${date}”.` };
      navigate(fieldOnly ? `/field/schedule?date=${d}` : `/admin/schedule?date=${d}`);
      const label = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" });
      return { ok: true, message: `Opened the calendar on ${label}.`, data: { date: d } };
    },

    list_todays_jobs: async (): Promise<MandyResult> => {
      const today = sastToday().toISOString().slice(0, 10);
      // Same source as the schedule page (job_schedules + lead + job address), RLS-scoped.
      let q = supabase
        .from("job_schedules")
        .select("id, start_time, lead_id, agent_id, leads(customer_name, customer_address)")
        .eq("scheduled_date", today)
        .order("start_time");
      if (fieldOnly && user?.id) q = q.eq("agent_id", user.id);
      const { data, error } = await q;
      if (error) return { ok: false, message: `Could not load today's jobs: ${error.message}` };
      const rows = (data || []) as any[];
      navigate(fieldOnly ? `/field/schedule?date=${today}` : `/admin/schedule?date=${today}`);
      if (!rows.length) return { ok: true, message: "No jobs scheduled today.", data: { count: 0 } };
      const first = rows.slice(0, 3).map((r) => {
        const sub = suburb(r.leads?.customer_address);
        return `${String(r.start_time || "").slice(0, 5)} ${r.leads?.customer_name || "Job"}${sub ? `, ${sub}` : ""}`;
      });
      const more = rows.length > 3 ? ` The other ${rows.length - 3} are on screen.` : "";
      return { ok: true, message: `${rows.length} job${rows.length === 1 ? "" : "s"} today: ${first.join("; ")}.${more}`, data: { count: rows.length } };
    },

    ...(makeMapHandlers(navigate) as Record<string, (a: Record<string, unknown>) => Promise<MandyResult>>),
  });
}

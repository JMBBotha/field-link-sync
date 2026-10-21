import { invoiceMissingPrices } from "@/lib/invoicePriced";
/**
 * Mandy work toolkit (Johan 13 Oct 2026, phase 3): invoices, payments, POs, jobs,
 * WhatsApp quotes/invoices. Every handler runs in the browser under the signed-in
 * user's session (RLS + existing RPCs). Anything client-facing returns a
 * "Send this?" confirm card; nothing goes out on voice alone.
 * Money follow-ups (reminders on invoices already sent) are NOT here — they need an
 * owner-approved per-client record (phase 4, payment_followup_* + claim RPC).
 */
import type { MandyResult } from "./actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
export interface WorkDeps {
  db: Db;
  navigate: (to: string) => void;
  userId?: string | null;
  today: () => string; // YYYY-MM-DD (SAST)
  openWindow: () => { location: { href: string } } | null; // must be called inside the tap
  publicQuoteUrl: (token: string) => string;
  recordPayment: (i: { invoiceId: string; amount: number; method: string; reference?: string | null }) => Promise<string>;
  ensureQuoteReadyToSend: (quoteId: string) => Promise<void>;
  fmtRand: (n: number) => string;
}

export const OPEN_INVOICE_EXCLUDED = ["paid", "draft", "cancelled", "void", "archived"];
const INV_COLS = "id, invoice_number, customer_name, customer_phone, grand_total, due_date, status, sent_at, sent_method, quote_id, company_id";

/** SA mobile → wa.me digits (0821234567 → 27821234567). Null when unusable. */
export function waDigits(phone?: string | null): string | null {
  let d = String(phone || "").replace(/[^0-9+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = `27${d.slice(1)}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}
export const waLink = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

export const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86400000);

/** An invoice the client already received (emailed, WhatsApped or marked sent by hand). */
export const invoiceWasSent = (inv: { sent_at?: string | null; sent_method?: string | null; status?: string | null }) =>
  !!inv.sent_at || !!inv.sent_method || ["sent", "overdue", "partially_paid", "part_paid", "viewed"].includes(String(inv.status || "").toLowerCase());

async function resolveInvoice(d: WorkDeps, ref?: string, client?: string, action = "open_invoice"): Promise<any | MandyResult> {
  let q = d.db.from("invoices").select(INV_COLS).order("created_at", { ascending: false }).limit(6);
  if (ref) q = q.ilike("invoice_number", `%${String(ref).trim()}%`);
  else if (client) q = q.ilike("customer_name", `%${String(client).trim()}%`);
  else return { ok: false, message: "Say the invoice number or the client's name." } as MandyResult;
  const { data, error } = await q;
  if (error) return { ok: false, message: `Could not load invoices: ${error.message}` } as MandyResult;
  if (!data?.length) return { ok: false, message: `No invoice matching “${ref || client}”.` } as MandyResult;
  if (data.length === 1) return data[0];
  return {
    ok: true, message: "Several invoices match. Waiting for the user to tap one.",
    choices: data.map((i: any) => ({ label: `${i.invoice_number} · ${i.customer_name}`, action, args: { invoice_ref: i.invoice_number } })),
  } as MandyResult;
}
const isResult = (x: any): x is MandyResult => x && typeof x === "object" && "ok" in x && "message" in x;

async function resolveJob(d: WorkDeps, ref?: string, action = "start_job"): Promise<any | MandyResult> {
  let q = d.db.from("jobs").select("id, title, status, scheduled_for, address").order("scheduled_for", { ascending: true, nullsFirst: false }).limit(6);
  q = ref ? q.ilike("title", `%${String(ref).trim()}%`) : q.in("status", ["scheduled", "in_progress"]).gte("scheduled_for", `${d.today()}T00:00:00+02:00`).lte("scheduled_for", `${d.today()}T23:59:59+02:00`);
  const { data, error } = await q;
  if (error) return { ok: false, message: `Could not load jobs: ${error.message}` } as MandyResult;
  if (!data?.length) return { ok: false, message: ref ? `No job matching “${ref}”.` : "No open job today. Say the client's name." } as MandyResult;
  if (data.length === 1) return data[0];
  return { ok: true, message: "Several jobs match. Waiting for the user to tap one.", choices: data.map((j: any) => ({ label: j.title, action, args: { job_ref: j.title } })) } as MandyResult;
}

export function makeWorkHandlers(d: WorkDeps) {
  return {
    list_overdue_invoices: async (): Promise<MandyResult> => {
      const today = d.today();
      const { data, error } = await d.db.from("invoices").select(INV_COLS).lt("due_date", today)
        .not("status", "in", `(${OPEN_INVOICE_EXCLUDED.join(",")})`).order("due_date", { ascending: true }).limit(20);
      if (error) return { ok: false, message: `Could not load invoices: ${error.message}` };
      const rows = (data || []).filter(invoiceWasSent);
      if (!rows.length) return { ok: true, message: "No invoices are past their due date.", data: { count: 0 } };
      d.navigate("/admin/invoices");
      const top = rows.slice(0, 3).map((i: any) => `${i.customer_name} ${d.fmtRand(Number(i.grand_total))}, ${daysBetween(i.due_date, today)} days late`);
      return { ok: true, message: `${rows.length} invoice${rows.length === 1 ? " is" : "s are"} past due: ${top.join("; ")}. A reminder needs the owner's approval first.`, data: { count: rows.length } };
    },

    record_payment: async ({ invoice_ref, client, amount, method, reference }: Record<string, any>): Promise<MandyResult> => {
      const amt = Math.round((Number(amount) || 0) * 100) / 100;
      if (!(amt > 0)) return { ok: false, message: "Say the amount received, e.g. 'R5 000 by EFT'." };
      const inv = await resolveInvoice(d, invoice_ref, client, "record_payment");
      if (isResult(inv)) return inv;
      const m = ["cash", "eft", "card", "other"].includes(String(method || "").toLowerCase()) ? String(method).toLowerCase() : "eft";
      return {
        ok: true, message: `Awaiting on-screen confirmation to record ${d.fmtRand(amt)} on invoice ${inv.invoice_number}.`,
        confirm: {
          summary: `Record a ${m.toUpperCase()} payment of ${d.fmtRand(amt)} on invoice ${inv.invoice_number} (${inv.customer_name})?`,
          lines: [`Invoice total ${d.fmtRand(Number(inv.grand_total))}`, reference ? `Reference: ${reference}` : "No reference"],
          run: async () => {
            await d.recordPayment({ invoiceId: inv.id, amount: amt, method: m, reference: reference || null });
            return { ok: true, message: `Recorded ${d.fmtRand(amt)} on invoice ${inv.invoice_number}.` };
          },
        },
      };
    },

    whatsapp_invoice: async ({ invoice_ref, client }: Record<string, any>): Promise<MandyResult> => {
      const inv = await resolveInvoice(d, invoice_ref, client, "whatsapp_invoice");
      if (isResult(inv)) return inv;
      if (String(inv.status).toLowerCase() === "paid") return { ok: false, message: `Invoice ${inv.invoice_number} is already paid.` };
      { const missing = await invoiceMissingPrices(inv.id, d.db); if (missing) return { ok: false, message: `Invoice ${inv.invoice_number}: ${missing}` }; }
      if (invoiceWasSent(inv)) {
        return { ok: false, message: `Invoice ${inv.invoice_number} was already sent, so another message would be a payment follow-up. That needs the owner's approval first — open Payment follow-ups.` };
      }
      const digits = waDigits(inv.customer_phone);
      if (!digits) return { ok: false, message: `There's no usable mobile number for ${inv.customer_name}.` };
      const due = inv.due_date ? `, due ${inv.due_date}` : "";
      const text = `Hi ${inv.customer_name}, please find invoice ${inv.invoice_number} for ${d.fmtRand(Number(inv.grand_total))}${due}. Let us know if you have any questions. Thank you!`;
      return {
        ok: true, message: `Awaiting "Send this?" confirmation for invoice ${inv.invoice_number}.`,
        confirm: {
          summary: `Send this? WhatsApp invoice ${inv.invoice_number} to ${inv.customer_name}`,
          lines: [`To: +${digits}`, text],
          run: async () => {
            const w = d.openWindow();
            if (w) w.location.href = waLink(digits, text);
            const { error } = await d.db.from("invoices").update({
              sent_at: new Date().toISOString(), sent_method: "whatsapp", sent_channel: "whatsapp", sent_by: d.userId || null,
              ...(String(inv.status).toLowerCase() === "draft" ? { status: "sent" } : {}),
            }).eq("id", inv.id);
            if (error) return { ok: false, message: `WhatsApp opened, but I couldn't mark the invoice as sent: ${error.message}` };
            return { ok: true, message: `WhatsApp is open with invoice ${inv.invoice_number} for ${inv.customer_name}. Tap send there.` };
          },
        },
      };
    },

    whatsapp_quote: async ({ quote_ref }: Record<string, any>): Promise<MandyResult> => {
      const ref = String(quote_ref || "").trim();
      let q = d.db.from("quotes").select("id, quote_number, status, total, customer_name, customer_id, public_token").order("created_at", { ascending: false }).limit(5);
      q = ref ? q.or(`quote_number.ilike.%${ref}%,customer_name.ilike.%${ref}%`) : q;
      const { data, error } = await q;
      if (error) return { ok: false, message: `Could not load quotes: ${error.message}` };
      if (!data?.length) return { ok: false, message: ref ? `No quote matching “${ref}”.` : "Say the quote number or client." };
      if (data.length > 1 && ref) return { ok: true, message: "Several quotes match. Waiting for the user to tap one.", choices: data.map((x: any) => ({ label: `${x.quote_number || "Draft"} · ${x.customer_name}`, action: "whatsapp_quote", args: { quote_ref: x.quote_number } })) };
      const qt = data[0];
      if (["declined", "expired"].includes(String(qt.status))) return { ok: false, message: `Quote ${qt.quote_number} is ${qt.status}.` };
      const { data: cust } = qt.customer_id ? await d.db.from("customers").select("phone").eq("id", qt.customer_id).maybeSingle() : { data: null };
      const digits = waDigits(cust?.phone);
      if (!digits) return { ok: false, message: `There's no usable mobile number for ${qt.customer_name}.` };
      return {
        ok: true, message: `Awaiting "Send this?" confirmation for quote ${qt.quote_number}.`,
        confirm: {
          summary: `Send this? WhatsApp quote ${qt.quote_number} to ${qt.customer_name}`,
          lines: [`To: +${digits}`, `Hi ${qt.customer_name}, your quote ${qt.quote_number} for ${d.fmtRand(Number(qt.total))} is ready. View and accept it here: (link)`],
          run: async () => {
            const w = d.openWindow();
            await d.ensureQuoteReadyToSend(qt.id);
            const { data: fresh } = await d.db.from("quotes").select("public_token").eq("id", qt.id).maybeSingle();
            const token = fresh?.public_token || qt.public_token;
            if (!token) return { ok: false, message: "The quote link isn't ready — nothing was sent." };
            const text = `Hi ${qt.customer_name}, your quote ${qt.quote_number} for ${d.fmtRand(Number(qt.total))} is ready. View and accept it here: ${d.publicQuoteUrl(token)}`;
            if (w) w.location.href = waLink(digits, text);
            return { ok: true, message: `WhatsApp is open with quote ${qt.quote_number} for ${qt.customer_name}. Tap send there.` };
          },
        },
      };
    },

    create_purchase_orders: async ({ invoice_ref, client }: Record<string, any>): Promise<MandyResult> => {
      const inv = await resolveInvoice(d, invoice_ref, client, "create_purchase_orders");
      if (isResult(inv)) return inv;
      return {
        ok: true, message: `Awaiting on-screen confirmation to draft POs for invoice ${inv.invoice_number}.`,
        confirm: {
          summary: `Draft purchase orders for invoice ${inv.invoice_number} (${inv.customer_name})?`,
          lines: ["One draft PO per supplier from the invoice's units and materials. Nothing is sent to suppliers."],
          run: async () => {
            const { data, error } = await d.db.rpc("create_draft_pos_for_invoice", { p_invoice: inv.id });
            if (error) return { ok: false, message: `Couldn't draft the POs: ${error.message}` };
            d.navigate(`/admin/invoices/${inv.id}`);
            const n = Array.isArray(data) ? data.length : Number((data as any)?.created ?? data ?? 0) || 0;
            return { ok: true, message: n ? `Drafted ${n} purchase order${n === 1 ? "" : "s"} for invoice ${inv.invoice_number}.` : `No new POs were needed for invoice ${inv.invoice_number}.` };
          },
        },
      };
    },

    list_purchase_orders: async (): Promise<MandyResult> => {
      const { data, error } = await d.db.from("purchase_orders").select("po_number, status, total, client_name").in("status", ["draft", "ordered", "sent"]).order("created_at", { ascending: false }).limit(10);
      if (error) return { ok: false, message: `Could not load POs: ${error.message}` };
      if (!data?.length) return { ok: true, message: "No open purchase orders." };
      return { ok: true, message: `${data.length} open PO${data.length === 1 ? "" : "s"}: ${data.slice(0, 3).map((p: any) => `${p.po_number} ${p.status} ${d.fmtRand(Number(p.total))}`).join("; ")}.` };
    },

    list_my_jobs: async (): Promise<MandyResult> => {
      const from = d.today();
      const to = new Date(Date.parse(`${from}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await d.db.from("jobs").select("id, title, status, scheduled_for").in("status", ["scheduled", "in_progress"])
        .gte("scheduled_for", `${from}T00:00:00+02:00`).lte("scheduled_for", `${to}T23:59:59+02:00`).order("scheduled_for").limit(10);
      if (error) return { ok: false, message: `Could not load jobs: ${error.message}` };
      if (!data?.length) return { ok: true, message: "No jobs in the next 7 days." };
      const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
      return { ok: true, message: `${data.length} job${data.length === 1 ? "" : "s"} this week: ${data.slice(0, 3).map((j: any) => `${fmt(j.scheduled_for)} ${j.title}`).join("; ")}.` };
    },

    start_job: async ({ job_ref }: Record<string, any>): Promise<MandyResult> => {
      const j = await resolveJob(d, job_ref, "start_job");
      if (isResult(j)) return j;
      if (j.status === "in_progress") return { ok: true, message: `${j.title} is already in progress.` };
      return {
        ok: true, message: `Awaiting on-screen confirmation to start ${j.title}.`,
        confirm: {
          summary: `Start job: ${j.title}?`,
          run: async () => {
            const { error } = await d.db.rpc("tech_set_job_status", { p_job_id: j.id, p_status: "in_progress" });
            if (error) return { ok: false, message: `Couldn't start the job: ${error.message}` };
            return { ok: true, message: `${j.title} is now in progress.` };
          },
        },
      };
    },

    open_job: async ({ job_ref }: Record<string, any>): Promise<MandyResult> => {
      const j = await resolveJob(d, job_ref, "open_job");
      if (isResult(j)) return j;
      d.navigate(`/admin/jobs/${j.id}`);
      return { ok: true, message: `Opened ${j.title}. Notes, photos, parts and completion are on this screen.`, data: { job_id: j.id } };
    },

    list_payment_followups: async (): Promise<MandyResult> => {
      const { data, error } = await d.db.from("payment_followups").select("id, customer_name, invoice_number, amount_due, days_late, status").in("status", ["pending", "approved"]).order("created_at", { ascending: false }).limit(20);
      if (error) return { ok: false, message: `Could not load follow-ups: ${error.message}` };
      if (!data?.length) return { ok: true, message: "No payment follow-ups are waiting." };
      const pending = data.filter((f: any) => f.status === "pending"), approved = data.filter((f: any) => f.status === "approved");
      const name = (f: any) => `${f.customer_name} ${d.fmtRand(Number(f.amount_due))}${f.days_late != null ? `, ${f.days_late} days late` : ""}`;
      return { ok: true, message: `${pending.length} waiting for the owner's decision${pending.length ? ` (${pending.slice(0, 3).map(name).join("; ")})` : ""}; ${approved.length} approved and ready to send.` };
    },

    open_payment_followups: async (): Promise<MandyResult> => {
      d.navigate("/admin/payment-followups");
      return { ok: true, message: "Opened Payment follow-ups." };
    },

    request_payment_followup: async ({ invoice_ref, client }: Record<string, any>): Promise<MandyResult> => {
      const inv = await resolveInvoice(d, invoice_ref, client, "request_payment_followup");
      if (isResult(inv)) return inv;
      return {
        ok: true, message: `Awaiting on-screen confirmation to ask the owner about a follow-up for ${inv.customer_name}.`,
        confirm: {
          summary: `Ask the owner to approve a friendly payment reminder for ${inv.customer_name} (invoice ${inv.invoice_number})?`,
          lines: ["Nothing is sent to the client. The owner approves, edits or declines first."],
          run: async () => {
            const { error } = await d.db.rpc("pf_request", { p_invoice: inv.id });
            if (error) return { ok: false, message: error.message };
            return { ok: true, message: `Done. The owner has been asked about ${inv.customer_name}. Nothing goes to the client until it's approved.` };
          },
        },
      };
    },

    send_approved_followup: async ({ client }: Record<string, any>): Promise<MandyResult> => {
      let q = d.db.from("payment_followups").select("id, customer_name, customer_phone, invoice_number, approved_message").eq("status", "approved").order("decided_at", { ascending: false }).limit(5);
      if (client) q = q.ilike("customer_name", `%${String(client).trim()}%`);
      const { data, error } = await q;
      if (error) return { ok: false, message: `Could not load follow-ups: ${error.message}` };
      if (!data?.length) return { ok: false, message: client ? `There's no approved follow-up for ${client}. The owner has to approve one first.` : "No follow-ups are approved yet. The owner has to approve one first." };
      if (data.length > 1) return { ok: true, message: "Several approved follow-ups. Waiting for the user to tap one.", choices: data.map((f: any) => ({ label: `${f.customer_name} · ${f.invoice_number}`, action: "send_approved_followup", args: { client: f.customer_name } })) };
      const f = data[0];
      const digits = waDigits(f.customer_phone);
      if (!digits) return { ok: false, message: `There's no usable mobile number for ${f.customer_name}.` };
      return {
        ok: true, message: `Awaiting "Send this?" confirmation for the approved reminder to ${f.customer_name}.`,
        confirm: {
          summary: `Send this? Owner-approved reminder to ${f.customer_name} (invoice ${f.invoice_number})`,
          lines: [`To: +${digits}`, f.approved_message],
          run: async () => {
            const w = d.openWindow();
            const { data: claim, error: err } = await d.db.rpc("pf_claim_send", { p_id: f.id });
            if (err || !claim) { try { (w as any)?.close?.(); } catch { /* ignore */ } return { ok: false, message: err?.message || "Not sent." }; }
            if (w) w.location.href = waLink(digits, String((claim as any).message || f.approved_message));
            return { ok: true, message: `WhatsApp is open with the approved reminder for ${f.customer_name}. Tap send there.` };
          },
        },
      };
    },

    open_scheduler: async ({ date }: Record<string, any>): Promise<MandyResult> => {
      const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : d.today();
      d.navigate(`/admin/dispatch?date=${dt}`);
      return { ok: true, message: `Opened the scheduler on ${dt}. Drag the job to a tech and time to book it.` };
    },
  };
}

/* ───────── Top-level (parent) Mandy: Massair owner only, read-only across companies ─────────
 * Both RPCs are SECURITY DEFINER and refuse anyone who is not is_parent_owner(auth.uid());
 * they return aggregates only and write an audit row. Nothing here changes another company. */
type ParentRow = {
  company_id: string; company: string; is_master?: boolean; leads_today: number; leads_30d: number;
  quotes_waiting: number; quotes_waiting_value: number; invoices_open: number; outstanding: number;
  overdue_count: number; overdue_value: number; paid_this_month: number; jobs_today: number; jobs_open: number;
  followups_pending: number; users: number; plan_status?: string; mandy_enabled?: boolean;
};
export function parentSummary(rows: ParentRow[], fmt: (n: number) => string): string {
  if (!rows.length) return "No companies found.";
  const sum = (k: keyof ParentRow) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const worst = [...rows].filter((r) => Number(r.overdue_value) > 0).sort((a, b) => Number(b.overdue_value) - Number(a.overdue_value))[0];
  const parts = [
    `Across ${rows.length} companies: ${sum("leads_today")} leads today, ${sum("quotes_waiting")} quotes waiting (${fmt(sum("quotes_waiting_value"))})`,
    `${fmt(sum("outstanding"))} outstanding, of which ${fmt(sum("overdue_value"))} is overdue`,
    `${sum("jobs_today")} jobs today`,
  ];
  let msg = parts.join("; ") + ".";
  if (worst) msg += ` Most overdue: ${worst.company} (${fmt(Number(worst.overdue_value))}).`;
  const pend = sum("followups_pending");
  if (pend) msg += ` ${pend} payment follow-up${pend === 1 ? "" : "s"} waiting for approval.`;
  return msg;
}
export function makeParentHandlers(d: { db: Db; fmtRand: (n: number) => string; navigate: (to: string) => void }) {
  const load = async (): Promise<ParentRow[] | MandyResult> => {
    const { data, error } = await d.db.rpc("parent_overview");
    if (error) return { ok: false, message: error.message };
    return ((data as any)?.companies || []) as ParentRow[];
  };
  return {
    parent_overview: async (): Promise<MandyResult> => {
      const rows = await load();
      if (isResult(rows)) return rows;
      return { ok: true, message: parentSummary(rows, d.fmtRand), data: { companies: rows } };
    },
    parent_company_report: async ({ company }: Record<string, any>): Promise<MandyResult> => {
      const rows = await load();
      if (isResult(rows)) return rows;
      const q = String(company || "").trim().toLowerCase();
      const hits = q ? rows.filter((r) => r.company.toLowerCase().includes(q)) : [];
      if (!hits.length) return { ok: true, message: "Which company? Waiting for the user to tap one.", choices: rows.map((r) => ({ label: r.company, action: "parent_company_report", args: { company: r.company } })) };
      const r = hits[0];
      return { ok: true, data: r, message: `${r.company}: ${r.leads_today} leads today (${r.leads_30d} in 30 days), ${r.quotes_waiting} quotes waiting (${d.fmtRand(r.quotes_waiting_value)}), ${d.fmtRand(r.outstanding)} outstanding with ${d.fmtRand(r.overdue_value)} overdue on ${r.overdue_count} invoice${r.overdue_count === 1 ? "" : "s"}, ${d.fmtRand(r.paid_this_month)} paid this month, ${r.jobs_today} jobs today, ${r.users} users. Read only.` };
    },
    parent_overdue: async (): Promise<MandyResult> => {
      const { data, error } = await d.db.rpc("parent_overdue", { p_limit: 10 });
      if (error) return { ok: false, message: error.message };
      const rows = (data || []) as Array<{ company: string; invoice_number: string; customer_name: string; amount: number; days_late: number }>;
      if (!rows.length) return { ok: true, message: "No overdue invoices in any company." };
      return { ok: true, data: { rows }, message: `${rows.length} overdue: ${rows.slice(0, 4).map((r) => `${r.company}: ${r.customer_name} ${d.fmtRand(Number(r.amount))}, ${r.days_late} days`).join("; ")}. Reminders still need the owner's approval.` };
    },
  };
}

const s = (description: string) => ({ type: "string", description });
export const WORK_ACTION_SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  list_overdue_invoices: { description: "List invoices past their due date (read only). Never sends reminders.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  record_payment: { description: "Record a payment received from a client on an invoice (confirm card).", parameters: { type: "object", properties: { invoice_ref: s("Invoice number"), client: s("Client name if no number"), amount: { type: "number", description: "Amount in rand" }, method: s("cash, eft, card or other"), reference: s("Payment reference") }, required: ["amount"], additionalProperties: false } },
  whatsapp_invoice: { description: "WhatsApp an invoice to the client for the FIRST time (Send this? card). Not for reminders on invoices already sent.", parameters: { type: "object", properties: { invoice_ref: s("Invoice number"), client: s("Client name") }, additionalProperties: false } },
  whatsapp_quote: { description: "WhatsApp a quote link to the client (Send this? card).", parameters: { type: "object", properties: { quote_ref: s("Quote number or client name") }, additionalProperties: false } },
  create_purchase_orders: { description: "Draft supplier purchase orders for an invoice (confirm card). Nothing is sent to suppliers.", parameters: { type: "object", properties: { invoice_ref: s("Invoice number"), client: s("Client name") }, additionalProperties: false } },
  list_purchase_orders: { description: "List open purchase orders (read only).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  list_my_jobs: { description: "List the user's jobs for the next 7 days (read only).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  start_job: { description: "Mark a job as started / in progress (confirm card).", parameters: { type: "object", properties: { job_ref: s("Job title or client name; empty = today's job") }, additionalProperties: false } },
  open_job: { description: "Open a job to add notes, photos, parts or complete it.", parameters: { type: "object", properties: { job_ref: s("Job title or client name") }, additionalProperties: false } },
  list_payment_followups: { description: "Say which payment follow-ups are waiting for the owner or approved (read only).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  open_payment_followups: { description: "Open the Payment follow-ups screen (owner approves or declines reminders there).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  request_payment_followup: { description: "Ask the company owner to approve a friendly payment reminder for a client's overdue invoice. Sends nothing to the client.", parameters: { type: "object", properties: { invoice_ref: s("Invoice number"), client: s("Client name") }, additionalProperties: false } },
  send_approved_followup: { description: "Send a reminder the OWNER ALREADY APPROVED for this client (Send this? card). Fails if not approved.", parameters: { type: "object", properties: { client: s("Client name") }, additionalProperties: false } },
  open_scheduler: { description: "Open the dispatch scheduler on a date to book or move jobs.", parameters: { type: "object", properties: { date: s("YYYY-MM-DD") }, additionalProperties: false } },
  parent_overview: { description: "Top-level: numbers for ALL companies (leads, quotes waiting, outstanding, overdue, jobs). Read only.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  parent_company_report: { description: "Top-level: one company's numbers. Read only.", parameters: { type: "object", properties: { company: s("Company name as spoken") }, additionalProperties: false } },
  parent_overdue: { description: "Top-level: overdue invoices across all companies. Read only; never sends reminders.", parameters: { type: "object", properties: {}, additionalProperties: false } },
};

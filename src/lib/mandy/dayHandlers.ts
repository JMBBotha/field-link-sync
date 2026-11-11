/**
 * Day-to-day Mandy handlers. Every write calls the same RPC the screen uses.
 * The handler never writes on the first call: it returns a confirm card, and
 * "yes" or the Confirm button runs that function.
 */
import type { MandyResult } from "./actions";
import { confirmQuestion, explainLeadWaiting, noteMandyTurn, recentMandyTurns, techDaySentence, unpaidSentence, type LeadWait } from "./dayVoice";

type Db = any;
export interface DayDeps {
  db: Db;
  navigate: (to: string) => void;
  userId?: string | null;
  today: () => string;
  fmtRand: (n: number) => string;
  page?: () => string;
}

let lastOwnerMove: { customerId: string; name: string; fromId: string | null; fromName: string; toId: string; toName: string } | null = null;

const clean = (v: unknown) => String(v || "").trim().replace(/[%_]/g, "");
const one = <T,>(rows: T[] | null | undefined, label: string): T | MandyResult => {
  const list = rows || [];
  if (!list.length) return { ok: false, message: `No ${label} found.` };
  if (list.length > 1) {
    const names = list.slice(0, 6).map((r: any) => r.name || r.customer_name || r.full_name || r.title).filter(Boolean);
    return { ok: true, message: `${list.length} ${label}s match: ${names.join(", ")}. Say the full name.` };
  }
  return list[0];
};

async function person(db: Db, table: "customers" | "profiles" | "leads", name: string, cols: string) {
  const q = clean(name);
  if (!q) return { ok: false, message: "Who did you mean?" } as MandyResult;
  const { data, error } = await db.from(table).select(cols).ilike(table === "profiles" ? "full_name" : table === "leads" ? "customer_name" : "name", `%${q}%`).limit(6);
  if (error) return { ok: false, message: error.message } as MandyResult;
  return one(data, table === "profiles" ? "person" : table === "leads" ? "lead" : "client");
}

async function nameOf(db: Db, id: string | null) {
  if (!id) return "nobody";
  const { data } = await db.from("profiles").select("full_name").eq("id", id).maybeSingle();
  return String(data?.full_name || "that person");
}

function rpcFail(error: { message?: string } | null, data: any, fallback: string) {
  if (error) return error.message || fallback;
  if (data && data.ok === false) return String(data.message || fallback);
  return null;
}

export function makeDayHandlers(d: DayDeps) {
  const ask = (detail: string, run: () => Promise<MandyResult>): MandyResult => ({
    ok: true,
    message: confirmQuestion(detail),
    confirm: { summary: confirmQuestion(detail), run },
  });

  return {
    set_owner_rep: async ({ client, to_rep, reason }: Record<string, any>): Promise<MandyResult> => {
      const customer = await person(d.db, "customers", client, "id, name, owner_rep_id");
      if ("ok" in (customer as MandyResult)) return customer as MandyResult;
      const rep = await person(d.db, "profiles", to_rep, "id, full_name");
      if ("ok" in (rep as MandyResult)) return rep as MandyResult;
      const c = customer as { id: string; name: string; owner_rep_id: string | null };
      const r = rep as { id: string; full_name: string };
      const fromName = await nameOf(d.db, c.owner_rep_id);
      return ask(`Move ${c.name} from ${fromName} to ${r.full_name}`, async () => {
        const { data, error } = await d.db.rpc("set_customer_owner_rep", { p_customer_id: c.id, p_rep_id: r.id, p_reason: clean(reason) || "Voice request" });
        const fail = rpcFail(error, data, "Could not move the client.");
        if (fail) return { ok: false, message: fail };
        lastOwnerMove = { customerId: c.id, name: c.name, fromId: c.owner_rep_id, fromName, toId: r.id, toName: r.full_name };
        d.navigate(`/admin/customers/${c.id}`);
        return { ok: true, message: `Moved ${c.name} from ${fromName} to ${r.full_name}. Say undo that to put ${fromName} back.` };
      });
    },

    undo_owner_rep: async (): Promise<MandyResult> => {
      const last = lastOwnerMove;
      if (!last) return { ok: false, message: "There is no voice reassignment to undo." };
      return ask(`Put ${last.name} back to ${last.fromName}`, async () => {
        const { data, error } = await d.db.rpc("set_customer_owner_rep", { p_customer_id: last.customerId, p_rep_id: last.fromId, p_reason: "Undo voice reassignment" });
        const fail = rpcFail(error, data, "Could not undo that.");
        if (fail) return { ok: false, message: fail };
        lastOwnerMove = null;
        return { ok: true, message: `${last.name} is back with ${last.fromName}.` };
      });
    },

    assign_lead_technician: async ({ lead, technician, date, start, end }: Record<string, any>): Promise<MandyResult> => {
      const row = await person(d.db, "leads", lead, "id, customer_name, assigned_agent_id, primary_intent");
      if ("ok" in (row as MandyResult)) return row as MandyResult;
      const tech = await person(d.db, "profiles", technician, "id, full_name");
      if ("ok" in (tech as MandyResult)) return tech as MandyResult;
      const l = row as { id: string; customer_name: string };
      const t = tech as { id: string; full_name: string };
      if (d.userId) {
        const { data, error } = await d.db.rpc("sales_may_book_tech", { _uid: d.userId, _tech: t.id });
        if (!error && data === false) return { ok: false, message: `You can only book technicians assigned to you. ${t.full_name} is not one of them.` };
      }
      const day = String(date || "").slice(0, 10);
      const from = String(start || "");
      const to = String(end || "");
      if (!day || !from || !to) return { ok: false, message: `Which day and time should ${t.full_name} go to ${l.customer_name}?` };
      const { data: options, error: optErr } = await d.db.rpc("lead_assign_options", { p_lead_id: l.id, p_date: day });
      if (optErr) return { ok: false, message: optErr.message };
      if (options && options.ok === false) return { ok: false, message: String(options.message || "That lead is not available.") };
      const mode = String(options?.mode || "assign");
      const detail = mode === "request"
        ? `Ask to move ${l.customer_name} to ${t.full_name} on ${day}`
        : `Assign ${t.full_name} to ${l.customer_name} on ${day} from ${from} to ${to}`;
      return ask(detail, async () => {
        if (mode === "request") {
          const { data, error } = await d.db.rpc("request_lead_reassignment", { p_lead_id: l.id, p_preferred_tech_id: t.id, p_reason: "Voice request" });
          const fail = rpcFail(error, data, "Could not request that.");
          if (fail) return { ok: false, message: fail };
          return { ok: true, message: `Asked the office to move ${l.customer_name} to ${t.full_name}. Nothing changed until they approve.` };
        }
        const { data, error } = await d.db.rpc("assign_lead_to_tech", {
          p_lead_id: l.id, p_tech_id: t.id, p_date: day, p_start: from, p_end: to,
        });
        const fail = rpcFail(error, data, "Could not assign the technician.");
        if (fail) return { ok: false, message: fail };
        d.navigate(`/admin/dispatch?lead=${l.id}`);
        return { ok: true, message: `${t.full_name} is assigned to ${l.customer_name} on ${day}, ${from} to ${to}.` };
      });
    },

    cancel_visit: async ({ lead, reason, note }: Record<string, any>): Promise<MandyResult> => {
      const row = await person(d.db, "leads", lead, "id, customer_name");
      if ("ok" in (row as MandyResult)) return row as MandyResult;
      const l = row as { id: string; customer_name: string };
      const why = clean(reason);
      if (!why) return { ok: false, message: "Say the reason: cancelled by client, no longer needed, or no-show." };
      return ask(`Cancel the visit for ${l.customer_name}, reason ${why}`, async () => {
        const { data, error } = await d.db.rpc("cancel_booking_visit", { p_lead: l.id, p_reason: why, p_note: clean(note) || null, p_job: null });
        const fail = rpcFail(error, data, "Could not cancel the visit.");
        if (fail) return { ok: false, message: fail };
        return { ok: true, message: `Cancelled the visit for ${l.customer_name}. The lead and quotes stay open. No invoice and no call-out.` };
      });
    },

    reschedule_visit: async ({ lead, date, start, end }: Record<string, any>): Promise<MandyResult> => {
      const row = await person(d.db, "leads", lead, "id, customer_name");
      if ("ok" in (row as MandyResult)) return row as MandyResult;
      const l = row as { id: string; customer_name: string };
      const day = String(date || "").slice(0, 10);
      if (!day) return { ok: false, message: "Which day should the visit move to?" };
      const { data: visits, error } = await d.db.rpc("booking_visits", { p_lead: l.id });
      if (error) return { ok: false, message: error.message };
      const list = Array.isArray(visits) ? visits : [];
      if (!list.length) return { ok: false, message: `${l.customer_name} has no visit to move.` };
      const target = list[0];
      const next = list.map((v: any, i: number) => i === 0
        ? { ...v, date: day, start: start || v.start, end: end || v.end }
        : v);
      return ask(`Move ${l.customer_name}'s visit from ${target.date} to ${day}`, async () => {
        const { data, error: saveErr } = await d.db.rpc("set_booking_visits", { p_lead: l.id, p_visits: next });
        if (saveErr) return { ok: false, message: saveErr.message };
        return { ok: true, message: `Moved ${l.customer_name}'s visit to ${day}.`, data: data || undefined };
      });
    },

    why_lead_waiting: async ({ lead }: Record<string, any>): Promise<MandyResult> => {
      const row = await person(d.db, "leads", lead, "id, customer_name, accepted_at, assigned_agent_id, offer_count");
      if ("ok" in (row as MandyResult)) return row as MandyResult;
      const l = row as { id: string; customer_name: string; accepted_at: string | null; assigned_agent_id: string | null; offer_count: number | null };
      const [{ data: offers }, { data: flags }] = await Promise.all([
        d.db.from("lead_offers").select("status").eq("lead_id", l.id),
        d.db.rpc("get_lead_offer_flags"),
      ]);
      const pending = (offers || []).filter((o: any) => o.status === "pending").length;
      const flag = (flags || []).find((f: any) => f.lead_id === l.id);
      const snapshot: LeadWait = {
        name: l.customer_name || "That lead",
        accepted: !!l.accepted_at,
        assigned: !!l.assigned_agent_id,
        offerCount: Number(l.offer_count) || (offers || []).length,
        pendingOffers: pending,
        flag: flag?.issue || null,
      };
      return { ok: true, message: explainLeadWaiting(snapshot) };
    },

    unpaid_for: async ({ client, job }: Record<string, any>): Promise<MandyResult> => {
      const who = clean(client || job);
      if (!who) return { ok: false, message: "Which client or job?" };
      let q = d.db.from("invoices").select("invoice_number, customer_name, grand_total, status").not("status", "in", "(paid,void,cancelled,canceled,draft)").limit(12);
      q = client ? q.ilike("customer_name", `%${clean(client)}%`) : q.ilike("customer_name", `%${who}%`);
      const { data, error } = await q;
      if (error) return { ok: false, message: error.message };
      const rows = (data || []).map((i: any) => ({ label: i.invoice_number || i.customer_name, amount: Number(i.grand_total) || 0, status: String(i.status || "open") }));
      return { ok: true, message: unpaidSentence(who, rows, d.fmtRand) };
    },

    tech_day: async ({ technician }: Record<string, any>): Promise<MandyResult> => {
      let techId = d.userId || null;
      let techName = "You";
      if (clean(technician)) {
        const tech = await person(d.db, "profiles", technician, "id, full_name");
        if ("ok" in (tech as MandyResult)) return tech as MandyResult;
        const t = tech as { id: string; full_name: string };
        techId = t.id;
        techName = t.full_name;
      }
      if (!techId) return { ok: false, message: "Which technician?" };
      const day = d.today();
      const { data: slots, error } = await d.db.from("job_schedules").select("job_id, scheduled_date, start_time").eq("agent_id", techId).eq("scheduled_date", day);
      if (error) return { ok: false, message: error.message };
      const jobs: { title: string; when: string }[] = [];
      const materials: { name: string; qty: string }[] = [];
      for (const slot of slots || []) {
        const when = String(slot.start_time || "").slice(0, 5);
        let title = "Visit";
        if (slot.job_id) {
          const { data: job } = await d.db.from("jobs").select("title").eq("id", slot.job_id).maybeSingle();
          title = job?.title || "Job";
          const { data: pack } = await d.db.rpc("get_job_packing_list", { p_job_id: slot.job_id });
          for (const line of pack || []) materials.push({ name: String(line.item_name || line.item_code || "item"), qty: String(line.quantity ?? "") });
        }
        jobs.push({ title, when });
      }
      return { ok: true, message: techDaySentence(techName, jobs, materials) };
    },

    report_problem: async ({ summary }: Record<string, any>): Promise<MandyResult> => {
      const text = clean(summary);
      if (!text) return { ok: false, message: "What should I pass to the build team?" };
      noteMandyTurn("", text);
      const { data, error } = await d.db.functions.invoke("mandy-handoff", {
        body: { summary: text, page: d.page?.() || null, transcript: recentMandyTurns(), entity_ids: {} },
      });
      if (error) return { ok: false, message: "I couldn't pass that on just now. Please try again." };
      return { ok: true, message: "I'll pass that to the build team.", data: { handoff_id: (data as any)?.id || null } };
    },
  };
}

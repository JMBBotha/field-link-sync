import { describe, it, expect, vi } from "vitest";
import { makeWorkHandlers, waDigits, invoiceWasSent, WORK_ACTION_SCHEMAS } from "@/lib/mandy/workActions";
import { toolAllowed } from "../../supabase/functions/_shared/mandyPolicy";

/** Chainable fake: every builder method returns itself; awaiting gives {data,error}. */
function fakeDb(tables: Record<string, any[]>, rpc: Record<string, any> = {}) {
  const calls: any[] = [];
  const from = (t: string) => {
    const res = { data: tables[t] ?? [], error: null };
    const b: any = new Proxy({}, {
      get(_o, k) {
        if (k === "then") return (ok: any) => ok(res);
        if (k === "maybeSingle") return async () => ({ data: (tables[t] ?? [])[0] ?? null, error: null });
        if (k === "update") return (patch: any) => { calls.push({ t, patch }); return b; };
        return () => b;
      },
    });
    return b;
  };
  return { db: { from, rpc: vi.fn(async (n: string) => ({ data: rpc[n] ?? null, error: rpc[n] === undefined ? { message: `rpc ${n} refused` } : null })) }, calls };
}
const deps = (db: any, extra: any = {}) => ({
  db, navigate: vi.fn(), userId: "u1", today: () => "2026-10-13", openWindow: () => ({ location: { href: "" } }),
  publicQuoteUrl: (t: string) => `https://x/quote/${t}`, recordPayment: vi.fn(async () => "p1"), ensureQuoteReadyToSend: vi.fn(async () => {}),
  fmtRand: (n: number) => `R${n}`, ...extra,
});

describe("work actions", () => {
  it("SA numbers to wa.me", () => {
    expect(waDigits("082 123 4567")).toBe("27821234567");
    expect(waDigits("+27 82 123 4567")).toBe("27821234567");
    expect(waDigits("123")).toBeNull();
  });
  it("manually-sent invoices count as sent", () => {
    expect(invoiceWasSent({ sent_method: "manual" })).toBe(true);
    expect(invoiceWasSent({ status: "draft" })).toBe(false);
  });
  it("whatsapp_invoice refuses an invoice already sent (that's a follow-up)", async () => {
    const { db } = fakeDb({ invoices: [{ id: "i1", invoice_number: "0010001", customer_name: "Cape Estates", customer_phone: "0821234567", grand_total: 100, status: "sent", sent_at: "2026-09-01" }] });
    const r = await makeWorkHandlers(deps(db)).whatsapp_invoice({ invoice_ref: "0010001" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/owner's approval/);
  });
  it("whatsapp_invoice first send needs Send this? and marks sent", async () => {
    const { db, calls } = fakeDb({ invoices: [{ id: "i1", invoice_number: "0010002", customer_name: "Kloof", customer_phone: "0821234567", grand_total: 100, status: "draft" }] });
    const r = await makeWorkHandlers(deps(db)).whatsapp_invoice({ invoice_ref: "0010002" });
    expect(r.confirm?.summary).toMatch(/^Send this\?/);
    const done = await r.confirm!.run();
    expect(done.ok).toBe(true);
    expect(calls[0].patch).toMatchObject({ sent_method: "whatsapp", status: "sent" });
  });
  it("send_approved_followup without approval sends nothing", async () => {
    const { db } = fakeDb({ payment_followups: [] });
    const r = await makeWorkHandlers(deps(db)).send_approved_followup({ client: "Cape Estates" });
    expect(r.ok).toBe(false);
    expect(r.confirm).toBeUndefined();
  });
  it("approved follow-up goes through the single-use claim RPC", async () => {
    const { db } = fakeDb({ payment_followups: [{ id: "f1", customer_name: "Cape Estates", customer_phone: "0821234567", invoice_number: "1", approved_message: "Hi" }] }, { pf_claim_send: { message: "Hi friendly" } });
    const win = { location: { href: "" } };
    const r = await makeWorkHandlers(deps(db, { openWindow: () => win })).send_approved_followup({});
    expect(r.confirm?.summary).toMatch(/^Send this\?/);
    await r.confirm!.run();
    expect(db.rpc).toHaveBeenCalledWith("pf_claim_send", { p_id: "f1" });
    expect(win.location.href).toContain("wa.me/27821234567");
  });
  it("record_payment confirms before writing", async () => {
    const { db } = fakeDb({ invoices: [{ id: "i1", invoice_number: "0010003", customer_name: "A", grand_total: 500, status: "sent" }] });
    const d = deps(db);
    const r = await makeWorkHandlers(d).record_payment({ invoice_ref: "0010003", amount: 200, method: "eft" });
    expect(d.recordPayment).not.toHaveBeenCalled();
    await r.confirm!.run();
    expect(d.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: "i1", amount: 200, method: "eft" }));
  });
  it("roles: techs get job tools only, sales can WhatsApp quotes but not invoices", () => {
    expect(toolAllowed("tech", "start_job")).toBe(true);
    expect(toolAllowed("tech", "record_payment")).toBe(false);
    expect(toolAllowed("sales", "whatsapp_quote")).toBe(true);
    expect(toolAllowed("sales", "whatsapp_invoice")).toBe(false);
    expect(toolAllowed("sales", "send_approved_followup")).toBe(false);
    expect(toolAllowed("office", "request_payment_followup")).toBe(true);
    for (const n of Object.keys(WORK_ACTION_SCHEMAS)) expect(toolAllowed("admin", n)).toBe(true);
  });
});

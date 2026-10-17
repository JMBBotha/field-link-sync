import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { readSendReply, setLocalSendLock, getLocalSendLock, clearLocalSendLock } from "@/lib/quoteEmailSend";

const httpError = (status: number, body: unknown) => ({
  name: "FunctionsHttpError",
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
});

describe("duplicate-send guard: reading send-quote-email replies", () => {
  it("success", async () => {
    expect((await readSendReply({ success: true, id: "re_1" }, null)).kind).toBe("ok");
  });
  it("recently sent → asks to confirm, with who and when", async () => {
    const r = await readSendReply(null, httpError(409, { code: "RECENTLY_SENT", sentTo: "a@b.co", sentAt: "2026-10-17T08:00:00Z" }));
    expect(r).toEqual({ kind: "recent", sentTo: "a@b.co", sentAt: "2026-10-17T08:00:00Z" });
  });
  it("another send of this quote running → hard lock", async () => {
    const r = await readSendReply(null, httpError(409, { code: "SEND_IN_PROGRESS", sentTo: "a@b.co", startedAt: "2026-10-17T08:00:00Z" }));
    expect(r.kind).toBe("in_progress");
  });
  it("Resend refused → real failure with the reason", async () => {
    const r = await readSendReply(null, httpError(500, { code: "SEND_FAILED", reason: "Email service refused it (422): bad address" }));
    expect(r).toEqual({ kind: "failed", reason: "Email service refused it (422): bad address" });
  });
  it("gateway timeout / dropped connection → unknown (never treated as failed, so no blind resend)", async () => {
    expect((await readSendReply(null, httpError(504, { message: "timeout" }))).kind).toBe("unknown");
    expect((await readSendReply(null, { name: "FunctionsFetchError", message: "Failed to send a request" })).kind).toBe("unknown");
  });
  it("unsubscribed → skipped", async () => {
    expect((await readSendReply({ success: false, skipped: true, reason: "unsubscribed" }, null)).kind).toBe("skipped");
  });
});

describe("duplicate-send guard: same-tab lock survives closing the dialog", () => {
  beforeEach(() => sessionStorage.clear());
  it("set / read / clear only by the owning send", () => {
    setLocalSendLock("q1", "s1");
    expect(getLocalSendLock("q1")?.sendId).toBe("s1");
    clearLocalSendLock("q1", "other");
    expect(getLocalSendLock("q1")?.sendId).toBe("s1");
    clearLocalSendLock("q1", "s1");
    expect(getLocalSendLock("q1")).toBeNull();
  });
  it("expires so it can never stick", () => {
    sessionStorage.setItem("fl-quote-sending:q2", JSON.stringify({ sendId: "s", at: Date.now() - 7 * 60 * 1000 }));
    expect(getLocalSendLock("q2")).toBeNull();
  });
});

describe("duplicate-send guard: wiring", () => {
  const fn = readFileSync("supabase/functions/send-quote-email/index.ts", "utf8");
  const dlg = readFileSync("src/components/quoting/SendQuoteDialog.tsx", "utf8");
  const sql = readFileSync("supabase/migrations/20261017110000_quote_email_sends.sql", "utf8");
  it("server: Resend Idempotency-Key per press, 2-minute confirm, lock taken before the PDF", () => {
    expect(fn).toContain('"Idempotency-Key": `quote-email/${sendId}`');
    expect(fn).toContain("RECENT_RESEND_MS = 2 * 60 * 1000");
    expect(fn).toContain("RECENTLY_SENT");
    expect(fn).toContain("SEND_IN_PROGRESS");
    expect(fn).toContain("beginSend");
    expect(fn).toContain('from("communication_log").insert');
  });
  it("DB: one queued/sending row per quote (atomic lock) and stale expiry", () => {
    expect(sql).toMatch(/UNIQUE INDEX[^;]+quote_email_sends \(quote_id\) WHERE status IN \('queued', 'sending'\)/);
    expect(sql).toContain("interval '5 minutes'");
  });
  it("dialog: ref guard, no client-side send logging, no race-timeout that unlocks the button", () => {
    expect(dlg).toContain("inFlightRef.current = true");
    expect(dlg).not.toContain("communication_log");
    expect(dlg).not.toContain("Promise.race");
    expect(dlg).toContain("Still sending, please wait, don't resend.");
    expect(dlg).toContain("send again?");
  });
});

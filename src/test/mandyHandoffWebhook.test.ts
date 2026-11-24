import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HANDOFF_DEDUPE_MS,
  HANDOFF_WEBHOOK_KEYS,
  HUB_SIGNATURE_HEADER,
  REDACTED,
  RESEND_UNDELIVERED_LIMIT,
  asSavedHandoff,
  buildHandoffWebhookBody,
  handoffFingerprint,
  hubSignature256,
  isNearDuplicateHandoff,
  isUndeliveredOpen,
  postHandoffWebhook,
  redactHandoffText,
  resendUndelivered,
  scheduleAfterReply,
  utteranceExcerpt,
} from "../../supabase/functions/_shared/mandyHandoffWebhook";

const SECRET = "handoff-test-secret";
const HOOK = "https://hooks.example.test/mandy";

describe("POPIA hand-off text", () => {
  it("keeps a client name that is already in the request and strips contact details", () => {
    const text = "Please call Yaseen about the quote. Number 082 555 1234, email yaseen@example.com, 14 Oak Street, Cape Town, 8001. PO Box 12.";
    const out = redactHandoffText(text);
    expect(out).toContain("Yaseen");
    expect(out).not.toMatch(/082/);
    expect(out).not.toMatch(/example\.com/i);
    expect(out).not.toMatch(/Oak Street/i);
    expect(out).not.toMatch(/8001/);
    expect(out).not.toMatch(/PO Box/i);
    expect(out).not.toMatch(/Cape Town/);
  });

  it("redacts SA, international and labelled numbers without eating equipment talk", () => {
    expect(redactHandoffText("Call +27 82 555 1234 or (021) 555-0199 or +1 202 555 0143")).not.toMatch(/\d{3}/);
    expect(redactHandoffText("phone: 0825550199")).not.toMatch(/082/);
    expect(redactHandoffText("the 9000 BTU unit on the road, R680, INV-1042, 5 minutes")).toBe(
      "the 9000 BTU unit on the road, R680, INV-1042, 5 minutes",
    );
    expect(redactHandoffText("ID 8001015009087 stays out")).not.toMatch(/8001015009087/);
  });

  it("uses only the last user utterance and clips it", () => {
    const transcript = [
      "User: Earlier we spoke about the board",
      "Mandy: Looking that up now",
      "User: Cobus is at 9 Long Street and his email is cobus@example.com",
    ].join("\n");
    const excerpt = utteranceExcerpt(transcript);
    expect(excerpt).toContain("Cobus");
    expect(excerpt).not.toContain("Earlier");
    expect(excerpt).not.toMatch(/example\.com/i);
    expect(excerpt).not.toMatch(/Long Street/i);
    expect(utteranceExcerpt(`User: ${"a".repeat(400)}`).length).toBeLessThanOrEqual(240);
  });
});

describe("webhook body", () => {
  it("posts the agreed fields, an ISO time, and no client directory data", () => {
    const { body, raw } = buildHandoffWebhookBody({
      id: "9b1c0a40-7c2e-4d1a-9f0e-111111111111",
      company_id: "2a6d8c1e-1111-4222-8333-444444444444",
      user_name: "Almari Botha",
      role: "sales",
      created_at: "2026-11-24T12:00:01.250+00:00",
      summary: "Yaseen asked for a site visit. yaseen@example.com.",
      transcript: "User: Can you log that Yaseen called from 082 555 1234?",
    });
    expect(Object.keys(body)).toEqual([...HANDOFF_WEBHOOK_KEYS]);
    expect(body.user_name).toBe("Almari Botha");
    expect(body.role).toBe("sales");
    expect(body.created_at).toBe("2026-11-24T12:00:01.250Z");
    expect(body.summary).toContain("Yaseen");
    expect(body.summary).not.toMatch(/example\.com/i);
    expect(body.utterance).toContain("Yaseen");
    expect(body.utterance).not.toMatch(/082/);
    expect(raw).toBe(JSON.stringify(body));
    expect(raw).not.toMatch(/phone|email|address|entity_ids|transcript|page/i);
    expect(JSON.parse(raw)).not.toHaveProperty("client");
  });

  it("does not invent a client name when the hand-off never says one", () => {
    const { body } = buildHandoffWebhookBody({
      id: "9b1c0a40-7c2e-4d1a-9f0e-222222222222",
      company_id: null,
      user_name: "secret-user@example.com",
      role: "admin",
      created_at: "2026-11-24T12:00:00.000Z",
      summary: "The jobs board will not open.",
      transcript: null,
    });
    expect(body.summary).toBe("The jobs board will not open.");
    expect(body.utterance).toBe("");
    expect(body.user_name).toBeNull();
    expect(body.company_id).toBeNull();
  });
});

describe("signature and delivery", () => {
  it("signs the exact raw body with HMAC-SHA256 and sends the bearer secret", async () => {
    const { raw } = buildHandoffWebhookBody({
      id: "9b1c0a40-7c2e-4d1a-9f0e-333333333333",
      company_id: "2a6d8c1e-1111-4222-8333-444444444444",
      user_name: "Johan",
      role: "admin",
      created_at: "2026-11-24T12:00:00.000Z",
      summary: "Add a resend button",
      transcript: "User: Add a resend button",
    });
    const seen: { url: string; init: RequestInit }[] = [];
    const result = await postHandoffWebhook({
      url: HOOK,
      secret: SECRET,
      rawBody: raw,
      sleep: async () => undefined,
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return new Response(null, { status: 204 });
      },
    });
    expect(result).toEqual({ status: "delivered", error: null, attempts: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(new URL(HOOK).toString());
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.body).toBe(raw);
    expect(seen[0].init.redirect).toBe("manual");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    const expected = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
    expect(headers[HUB_SIGNATURE_HEADER]).toBe(expected);
    expect(await hubSignature256(SECRET, raw)).toBe(expected);
  });

  it("retries once and records the second outcome without throwing", async () => {
    let calls = 0;
    const delays: number[] = [];
    const recovered = await postHandoffWebhook({
      url: HOOK,
      secret: SECRET,
      rawBody: "{}",
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("nope yaseen@example.com", { status: 500 });
        return new Response("ok", { status: 200 });
      },
    });
    expect(recovered.status).toBe("delivered");
    expect(recovered.attempts).toBe(2);
    expect(delays).toEqual([400]);

    calls = 0;
    const down = await postHandoffWebhook({
      url: HOOK,
      secret: SECRET,
      rawBody: "{}",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        throw new Error(`connect failed ${SECRET}`);
      },
    });
    expect(calls).toBe(2);
    expect(down.status).toBe("failed");
    expect(down.attempts).toBe(2);
    expect(down.error).toMatch(/after 2 attempts/);
    expect(down.error).not.toContain(SECRET);
  });

  it("does not call out when the url or secret is missing, and refuses a non-https url", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    };
    expect((await postHandoffWebhook({ url: "", secret: SECRET, rawBody: "{}", fetchImpl })).status).toBe("skipped");
    expect((await postHandoffWebhook({ url: HOOK, secret: "  ", rawBody: "{}", fetchImpl })).status).toBe("skipped");
    const insecure = await postHandoffWebhook({ url: "http://hooks.example.test/mandy", secret: SECRET, rawBody: "{}", fetchImpl });
    expect(insecure.status).toBe("failed");
    expect(insecure.attempts).toBe(0);
    expect(calls).toBe(0);
  });

  it("treats a redirect as a failure so the bearer secret is not forwarded", async () => {
    let calls = 0;
    const result = await postHandoffWebhook({
      url: HOOK,
      secret: SECRET,
      rawBody: "{}",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/collect" } });
      },
    });
    expect(calls).toBe(2);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/HTTP 302/);
  });
});

describe("dedupe and resend", () => {
  const now = Date.parse("2026-11-24T12:00:05.000Z");
  const existing = {
    summary: "  Add a button. ",
    createdAt: "2026-11-24T12:00:04.000Z",
    userId: "user-1",
    companyId: "co-1",
  };

  it("treats the same request one second apart as one row, and a 5 second gap as a new row", () => {
    expect(HANDOFF_DEDUPE_MS).toBe(5000);
    expect(handoffFingerprint("  Add a button. ")).toBe("add a button");
    expect(handoffFingerprint("ADD   a button")).toBe("add a button");
    expect(isNearDuplicateHandoff(existing, { summary: "add a button", userId: "user-1", companyId: "co-1" }, now)).toBe(true);
    expect(isNearDuplicateHandoff(
      { ...existing, createdAt: "2026-11-24T12:00:00.000Z" },
      { summary: "add a button", userId: "user-1", companyId: "co-1" },
      now,
    )).toBe(false);
    expect(isNearDuplicateHandoff(existing, { summary: "add a different button", userId: "user-1", companyId: "co-1" }, now)).toBe(false);
    expect(isNearDuplicateHandoff(existing, { summary: "add a button", userId: "user-2", companyId: "co-1" }, now)).toBe(false);
  });

  it("parses the save result and only resends open undelivered rows", async () => {
    expect(asSavedHandoff({ id: "abc", deduped: true, created_at: "2026-11-24T12:00:00.000Z" })?.deduped).toBe(true);
    expect(asSavedHandoff('{"id":"abc","deduped":false,"created_at":"2026-11-24T12:00:00.000Z"}')?.id).toBe("abc");
    expect(asSavedHandoff({ id: "", deduped: false })).toBeNull();
    expect(isUndeliveredOpen({ status: "open", webhook_status: "pending" })).toBe(true);
    expect(isUndeliveredOpen({ status: "open", webhook_status: "delivered" })).toBe(false);
    expect(isUndeliveredOpen({ status: "closed", webhook_status: "failed" })).toBe(false);

    const seen: string[] = [];
    const result = await resendUndelivered([
      { id: "1", status: "open", webhook_status: "pending" },
      { id: "2", status: "open", webhook_status: "delivered" },
      { id: "3", status: "closed", webhook_status: "failed" },
      { id: "4", status: "open", webhook_status: "failed" },
      { id: "5", status: "open", webhook_status: "skipped" },
    ], async (row) => {
      seen.push(row.id);
      if (row.id === "4") return { status: "failed", error: "HTTP 500", attempts: 2 };
      if (row.id === "5") return { status: "skipped", error: "MANDY_HANDOFF_WEBHOOK_URL is not set", attempts: 0 };
      return { status: "delivered", error: null, attempts: 1 };
    });
    expect(seen).toEqual(["1", "4", "5"]);
    expect(result).toEqual({ ok: true, considered: 3, delivered: 1, failed: 1, skipped: 1 });
  });

  it("schedules delivery without waiting for it", async () => {
    let finished = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let seen: Promise<unknown> | null = null;
    scheduleAfterReply(gate.then(() => {
      finished = true;
    }), (promise) => {
      seen = promise;
    });
    expect(finished).toBe(false);
    expect(seen).toBeInstanceOf(Promise);
    release();
    await seen;
    expect(finished).toBe(true);
  });
});

describe("handoff function and migration", () => {
  const fn = readFileSync("supabase/functions/mandy-handoff/index.ts", "utf8");
  const shared = readFileSync("supabase/functions/_shared/mandyHandoffWebhook.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261124120000_mandy_handoff_webhook.sql", "utf8");

  it("returns before the webhook and keeps the url in an edge secret", () => {
    expect(fn).toContain("MANDY_HANDOFF_WEBHOOK_URL");
    expect(fn).toContain("MANDY_HANDOFF_WEBHOOK_SECRET");
    expect(fn).toContain("scheduleAfterReply(");
    expect(fn).toContain("currentWaitUntil()");
    expect(fn).toContain("save_mandy_handoff");
    expect(fn).not.toContain("await fetch");
    expect(fn).not.toContain("await deliverStoredHandoff");
    expect(fn).not.toMatch(/https:\/\/hooks\./);
    expect(fn).not.toMatch(/Deno\.cron|cron\.schedule/);
    expect(fn).not.toContain('from("customers"');
    expect(fn).not.toContain('from("leads"');
    expect(fn).not.toMatch(/select\([^)]*phone/i);
    expect(fn).not.toMatch(/signature_email|office_address/);
    expect(shared).toContain(HUB_SIGNATURE_HEADER);
    expect(shared).toContain("Bearer ${secret}");
  });

  it("dedupes inside 5 seconds and exposes resend without scheduling it", () => {
    expect(sql).toContain("mandy_handoff_fingerprint");
    expect(sql).toContain("interval '5 seconds'");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("RETURN NULL");
    expect(sql).toContain("webhook_status");
    expect(sql).toContain("webhook_error");
    expect(sql).toContain("webhook_attempts");
    expect(sql).toContain("webhook_sent_at");
    expect(sql).toContain("dedupe_key");
    expect(sql).not.toMatch(/cron\.schedule|net\.http_post/);
    expect(sql).not.toContain("https://");
    expect(fn).toContain('body.action === "resend_undelivered"');
    expect(fn).toContain("if (auth.userId) return json({ error: \"Forbidden\" }, 403);");
    expect(fn).toContain("RESEND_UNDELIVERED_LIMIT");
    expect(RESEND_UNDELIVERED_LIMIT).toBe(25);
    expect(fn.match(/runResendUndelivered\(db\)/g)).toHaveLength(1);
    expect(REDACTED).toBe("[redacted]");
  });
});

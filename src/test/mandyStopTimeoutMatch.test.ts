import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { makeDayHandlers } from "@/lib/mandy/dayHandlers";
import { HANDOFF_LOGGED, isStopUtterance, matchSpokenChoice } from "@/lib/mandy/dayVoice";
import { searchClientsForVoice } from "@/lib/mandy/clientLookup";
import { clientSearchTerms, phoneticKey, phoneticStems, rankSpokenNames } from "@/lib/mandy/nameMatch";
import { MandyRealtimeSession, type RealtimeGrant } from "@/lib/mandy/realtimeClient";
import {
  FILLER_FIRST_MS,
  FILLER_SECOND_MS,
  STILL_ON_IT,
  TOOL_TIMEOUT_SAY,
  historySeedMessages,
  nextWorkingFiller,
  responseCancelMessage,
  sayInChatPanel,
  settleWithin,
  shouldAutoReconnect,
  spokenPanelLine,
  takeIfCurrent,
  workingStepLabel,
} from "@/lib/mandy/realtimeTurn";

const leads = [
  { id: "eb5679d3", customer_name: "Cobus de Jager", accepted_at: null, assigned_agent_id: null, offer_count: 0 },
  { id: "p1", customer_name: "Piet Botha", accepted_at: null, assigned_agent_id: null, offer_count: 0 },
];

function leadDb(rows: typeof leads) {
  return {
    from(table: string) {
      const q: { pattern?: string; recent?: boolean } = {};
      const b: any = {
        select() { return b; },
        is() { return b; },
        ilike(_c: string, pattern: string) { q.pattern = String(pattern).replace(/%/g, "").toLowerCase(); return b; },
        order() { q.recent = true; return b; },
        limit() { return b; },
        eq() { return b; },
        then(ok: (v: unknown) => void) {
          if (table !== "leads") { ok({ data: [], error: null }); return; }
          const data = !q.recent && q.pattern
            ? rows.filter((l) => l.customer_name.toLowerCase().includes(q.pattern!))
            : rows;
          ok({ data, error: null });
        },
      };
      return b;
    },
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: vi.fn(async () => ({ data: { id: "1ebe0941" }, error: null })) },
  };
}

describe("fuzzy spoken names", () => {
  it("hears Quibus as Cobus and ignores de", () => {
    expect(phoneticKey("quibus")).toBe(phoneticKey("cobus"));
    expect(phoneticStems("quibus")).toContain("cobus");
    expect(clientSearchTerms("Quibus de York")).toEqual(expect.arrayContaining(["cobus", "quibus"]));
    const ranked = rankSpokenNames("Quibus de Jager", leads, (l) => l.customer_name);
    expect(ranked[0].name).toBe("Cobus de Jager");
    expect(ranked[0].score).toBeGreaterThanOrEqual(0.9);
    expect(ranked.map((r) => r.name)).not.toContain("Piet Botha");
  });

  it("offers Cobus for Quibus de York instead of no lead", () => {
    const ranked = rankSpokenNames("Quibus de York", leads, (l) => l.customer_name);
    expect(ranked.map((r) => r.name)).toContain("Cobus de Jager");
    expect(ranked.map((r) => r.name)).not.toContain("Piet Botha");
    expect(ranked[0].score).toBeGreaterThanOrEqual(0.55);
    expect(ranked[0].score).toBeLessThan(0.9);
  });

  it("why_lead_waiting offers the closest lead and logs a problem without promising a fix", async () => {
    const db = leadDb(leads);
    const handlers = makeDayHandlers({ db, navigate: vi.fn(), today: () => "2026-11-11", fmtRand: (n) => `R${n}` });
    const york = await handlers.why_lead_waiting({ lead: "Quibus de York" });
    expect(york.message).not.toMatch(/No lead found/);
    expect(york.choices?.map((c) => c.label)).toContain("Cobus de Jager");
    expect(york.message).toMatch(/chat panel/);
    const jager = await handlers.why_lead_waiting({ lead: "Quibus de Jager" });
    expect(jager.message).toMatch(/Cobus de Jager/);
    expect(jager.message).not.toMatch(/No lead found/);
    const logged = await handlers.report_problem({ summary: "She could not find Cobus" });
    expect(logged.message).toBe(HANDOFF_LOGGED);
    expect(logged.message).not.toMatch(/fix|pass that|build team/i);
    expect(db.functions.invoke).toHaveBeenCalled();
  });

  it("find_client keeps a sounds-like client the plain search missed", async () => {
    const cobus = { id: "850bc1ee", first_name: "Cobus", last_name: "de Jager", company_name: null, is_company: false, phone: "0820000000", email: null, primary_address_line1: null, city: null, status: "active", relevance: 0 };
    const piet = { ...cobus, id: "p1", first_name: "Piet", last_name: "Botha", phone: "0830000000" };
    const hits = await searchClientsForVoice("Quibus de York", {
      rpc: async (_fn, args) => {
        const term = String(args.search_term).toLowerCase();
        return { data: term.includes("cobus") ? [{ ...cobus, relevance: 0.2 }] : [], error: null };
      },
      recentCustomers: async () => ({ data: [cobus, piet], error: null }),
    });
    expect(hits.map((h) => h.id)).toContain("850bc1ee");
    expect(hits.map((h) => h.id)).not.toContain("p1");
  });
});

describe("stop, cancel, and tool timeout", () => {
  it("recognises stop and a spoken choice", () => {
    expect(isStopUtterance("stop")).toBe(true);
    expect(isStopUtterance("Mandy stop")).toBe(true);
    expect(isStopUtterance("stop talking")).toBe(true);
    expect(isStopUtterance("why is the lead waiting")).toBe(false);
    const choices = [{ label: "Cobus de Jager" }, { label: "Add new client" }];
    expect(matchSpokenChoice("the first one", choices)).toBe(0);
    expect(matchSpokenChoice("Cobus", choices)).toBe(0);
    expect(matchSpokenChoice("yes", choices)).toBe(0);
    expect(matchSpokenChoice("the second one", choices)).toBe(1);
    expect(matchSpokenChoice("stop", choices)).toBeNull();
    expect(responseCancelMessage()).toEqual({ type: "response.cancel" });
  });

  it("bounds a hung tool and drops the late result after Stop", async () => {
    vi.useFakeTimers();
    try {
      let release: (v: string) => void = () => undefined;
      const hung = new Promise<string>((r) => { release = r; });
      const pending = settleWithin(hung, 12_000, "fallback");
      await vi.advanceTimersByTimeAsync(11_000);
      release("late");
      const early = await pending;
      expect(early).toEqual({ value: "late", timedOut: false });
      const again = settleWithin(new Promise(() => undefined), 12_000, "fallback");
      await vi.advanceTimersByTimeAsync(12_000);
      expect(await again).toEqual({ value: "fallback", timedOut: true });
      expect(takeIfCurrent(1, 2, "late")).toBeNull();
      expect(takeIfCurrent(2, 2, "ok")).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("speaks one varied filler after 1.5s and Still on it after 6s, never a third", () => {
    const args = { lead: "Cobus de Jager" };
    expect(nextWorkingFiller({ tool: "why_lead_waiting", args, elapsedMs: 200, spokenThisTurn: [], recent: [] })).toBeNull();
    expect(nextWorkingFiller({ tool: "why_lead_waiting", args, elapsedMs: FILLER_FIRST_MS - 1, spokenThisTurn: [], recent: [] })).toBeNull();
    const first = nextWorkingFiller({ tool: "why_lead_waiting", args, elapsedMs: FILLER_FIRST_MS, spokenThisTurn: [], recent: [] });
    expect(first).toMatch(/Cobus/);
    const next = nextWorkingFiller({ tool: "why_lead_waiting", args, elapsedMs: FILLER_FIRST_MS, spokenThisTurn: [], recent: [first!] });
    expect(next).not.toBe(first);
    expect(nextWorkingFiller({ tool: "why_lead_waiting", args, elapsedMs: FILLER_SECOND_MS, spokenThisTurn: [first!], recent: [] })).toBe(STILL_ON_IT);
    expect(nextWorkingFiller({ tool: "why_lead_waiting", args, elapsedMs: 20_000, spokenThisTurn: [first!, STILL_ON_IT], recent: [] })).toBeNull();
    expect(nextWorkingFiller({ tool: "report_problem", args: { summary: "x" }, elapsedMs: 9_000, spokenThisTurn: [], recent: [] })).toBeNull();
    expect(workingStepLabel("find_client")).toBe("Looking up client…");
    expect(workingStepLabel("assign_lead_technician")).toBe("Checking visits…");
  });

  it("points her at the chat panel and reconnects a dropped socket", () => {
    expect(sayInChatPanel("Look on the dashboard and scroll up")).toBe("Look in my chat panel and look at the buttons in my chat panel");
    expect(spokenPanelLine("Waiting for the user to tap one.", "choices")).toMatch(/buttons in my chat panel/);
    expect(spokenPanelLine("Move him, yes?", "confirm")).toMatch(/Confirm button in my chat panel/);
    expect(shouldAutoReconnect({ userStopped: false, swapping: false, attempts: 0 })).toBe(true);
    expect(shouldAutoReconnect({ userStopped: true, swapping: false, attempts: 0 })).toBe(false);
    expect(shouldAutoReconnect({ userStopped: false, swapping: true, attempts: 0 })).toBe(false);
    expect(shouldAutoReconnect({ userStopped: false, swapping: false, attempts: 2 })).toBe(false);
    const seed = historySeedMessages([{ role: "user", text: "Cobus" }, { role: "assistant", text: "Looking up Cobus now…" }]);
    expect(seed).toHaveLength(2);
    expect(JSON.stringify(seed)).not.toContain("force_message");
    expect(HANDOFF_LOGGED).toBe("I've logged that for Field Lynk Prototyper to look into.");
    const src = readFileSync("supabase/functions/_shared/mandyRealtime.ts", "utf8");
    expect(src).toContain(HANDOFF_LOGGED);
    expect(src).toContain("buttons in my chat panel");
    expect(src).toContain("MANDY_CLIENT_SECRET_SECONDS = 600");
    const handoff = readFileSync("supabase/functions/mandy-handoff/index.ts", "utf8");
    expect(handoff).not.toContain("await fetch(hook");
  });
});

class FakeSocket {
  static OPEN = 1;
  static sockets: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean; target: FakeSocket }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string, public protocols?: string[]) {
    FakeSocket.sockets.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(raw: string) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.type === "session.update") {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "session.updated" }) }));
    }
  }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: code === 1000, target: this });
  }
}

function audioCtx() {
  const node = { connect() {}, disconnect() {}, onaudioprocess: null as any };
  return {
    state: "running",
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => undefined,
    createMediaStreamSource: () => node,
    createScriptProcessor: () => node,
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
    createBuffer: () => ({ duration: 0, getChannelData: () => new Float32Array(0) }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null, buffer: null }),
  } as unknown as AudioContext;
}

function grant(): RealtimeGrant {
  return {
    token: "xai-realtime-client-secret-test",
    expires_at: Math.floor(Date.now() / 1000) + 600,
    url: "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
    session: { tools: [{ name: "why_lead_waiting" }, { name: "report_problem" }] },
  };
}

describe("realtime session stop and timeout", () => {
  afterEach(() => {
    FakeSocket.sockets = [];
    vi.unstubAllGlobals();
  });

  async function boot(execute: (name: string, args: Record<string, unknown>) => Promise<any>, onReply = vi.fn(), onPhase = vi.fn(), onTrace = vi.fn()) {
    vi.stubGlobal("WebSocket", FakeSocket);
    const fetchGrant = vi.fn(async () => grant());
    const session = new MandyRealtimeSession({
      fetchGrant,
      execute,
      ensureHandler: async () => true,
      listToolNames: () => ["why_lead_waiting", "report_problem"],
      onPhase,
      onLevel: () => undefined,
      onHeard: () => undefined,
      onReply,
      onChoices: () => undefined,
      onConfirm: () => undefined,
      onFatal: () => undefined,
      onTrace,
      audioContext: audioCtx,
      mic: async () => ({}) as MediaStream,
    }, { toolTimeoutMs: 40 });
    await session.start({ greeting: null });
    return { session, fetchGrant, onReply, onPhase, onTrace };
  }

  it("Stop sends response.cancel and ignores a late tool result", async () => {
    let release: (v: { ok: boolean; message: string }) => void = () => undefined;
    const { session, onReply } = await boot(() => new Promise((r) => { release = r; }));
    const ws = FakeSocket.sockets[0];
    ws.onmessage?.({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "why is Cobus waiting" }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "response.function_call_arguments.done", name: "why_lead_waiting", call_id: "c1", arguments: "{\"lead\":\"Cobus\"}" }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
    session.interrupt();
    expect(ws.sent.some((m) => m.type === "response.cancel")).toBe(true);
    release({ ok: true, message: "Cobus is still waiting." });
    await new Promise((r) => setTimeout(r, 80));
    expect(onReply.mock.calls.map((c) => c[0]).join(" ")).not.toMatch(/still waiting|too long/i);
    session.stop();
  });

  it("a hung tool speaks the timeout line instead of staying on Thinking", async () => {
    const { session, onReply, onPhase } = await boot(() => new Promise(() => undefined));
    const ws = FakeSocket.sockets[0];
    ws.onmessage?.({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "why is Cobus waiting" }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "response.function_call_arguments.done", name: "why_lead_waiting", call_id: "c1", arguments: "{\"lead\":\"Cobus\"}" }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
    await vi.waitFor(() => expect(onReply).toHaveBeenCalledWith(TOOL_TIMEOUT_SAY), { timeout: 2000 });
    expect(onPhase.mock.calls.at(-1)?.[0]).toBe("speaking");
    session.stop();
  });

  it("logs the close code and reconnects with a fresh token", async () => {
    const { session, fetchGrant, onTrace, onPhase } = await boot(async () => ({ ok: true, message: "ok" }));
    expect(fetchGrant).toHaveBeenCalledTimes(1);
    FakeSocket.sockets[0].close(1006, "expired");
    await vi.waitFor(() => expect(fetchGrant.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    const close = onTrace.mock.calls.find((c) => c[0] === "socket_close");
    expect(close?.[1]).toMatchObject({ code: 1006, reason: "expired" });
    await vi.waitFor(() => expect(onPhase.mock.calls.map((c) => c[0])).toContain("disconnected"), { timeout: 2000 });
    await vi.waitFor(() => expect(onPhase.mock.calls.at(-1)?.[0]).toBe("listening"), { timeout: 2000 });
    session.stop();
  });
});

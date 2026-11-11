/**
 * Dashboard Mandy speech-to-speech session.
 * Audio goes to wss://api.x.ai/v1/realtime with an ephemeral token from
 * mandy-realtime. Tools run through the dock's existing handlers.
 *
 * A dropped socket is not the 120-minute session cap. The client secret is
 * separate, refresh used to run only while she was Listening, and a close
 * used to end the call. Close code and reason are logged, then we reconnect
 * with a fresh token and the recent turns.
 * Phone Mandy (Vapi) does not use this module.
 */
import type { MandyChoice, MandyResult } from "./actions";
import { HANDOFF_LOGGED } from "./dayVoice";
import { fallbackRoute } from "./honestFallback";
import {
  FILLER_FIRST_MS,
  FILLER_SECOND_MS,
  REALTIME_SAMPLE_RATE,
  TOOL_TIMEOUT_MS,
  TOOL_TIMEOUT_SAY,
  appendAudioMessage,
  bargeIn,
  base64Pcm16ToFloat32,
  closeTrace,
  downsampleFloat,
  floatToPcm16Base64,
  forceMessageItem,
  functionCallOutputMessage,
  historySeedMessages,
  nextMandyPhase,
  nextWorkingFiller,
  phaseAfterResponseDone,
  replyPlan,
  responseCancelMessage,
  responseCreateMessage,
  rmsLevel,
  sessionUpdateMessage,
  settleWithin,
  shouldAutoReconnect,
  shouldForwardMic,
  spokenPanelLine,
  spokenToolText,
  truncatePlaybackMessage,
  userTextMessage,
  workingStepLabel,
  type MandyPhase,
} from "./realtimeTurn";

const OPEN_QUOTE = /^(open_quote|open_last_quote|open_latest_quote|open_top_quote|create_quote_for_client)$/;

export interface RealtimeGrant {
  token: string;
  expires_at?: number;
  url: string;
  session: { tools?: Array<{ name?: string }> };
}

type ConfirmCard = NonNullable<MandyResult["confirm"]>;

export interface RealtimeHandlers {
  fetchGrant: (kind: "session" | "tools") => Promise<RealtimeGrant>;
  execute: (name: string, args: Record<string, unknown>) => Promise<MandyResult>;
  /** True once a handler exists. Used only when the model calls a tool the page has not mounted yet. */
  ensureHandler: (name: string) => Promise<boolean>;
  listToolNames: () => string[];
  onPhase: (phase: MandyPhase) => void;
  onLevel: (level: number) => void;
  onHeard: (text: string, final?: boolean) => void;
  onReply: (text: string) => void;
  onChoices: (choices: MandyChoice[]) => void;
  onConfirm: (confirm: ConfirmCard | null) => void;
  onFatal: (message: string) => void;
  onWorking?: (step: string | null) => void;
  onConnection?: (state: "live" | "disconnected") => void;
  onTrace?: (kind: string, detail: Record<string, unknown>) => void;
  audioContext: () => AudioContext | null;
  mic: () => Promise<MediaStream>;
}

export interface RealtimeSessionOptions {
  toolTimeoutMs?: number;
}

export class MandyRealtimeSession {
  private ws: WebSocket | null = null;
  private stopped = false;
  private phase: MandyPhase = "idle";
  private player: PcmPlayer | null = null;
  private stopMic: (() => void) | null = null;
  private allowed = new Set<string>();
  private heard = "";
  private reply = "";
  private itemId: string | null = null;
  private calls: Array<{ name: string; callId: string; args: string }> = [];
  private turnDone = false;
  private executing = false;
  private hadAudio = false;
  private conversationId: string | null = null;
  private sessionUpdated: (() => void) | null = null;
  private starting = false;
  /** Loud speech during playback: keep forwarding after the first frame that clears the echo gate. */
  private bargeLatched = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private opened = false;
  /** Bumped by Stop so a late tool result is ignored. */
  private generation = 0;
  private ignoreAudio = false;
  /** A working filler must not flip the status off Thinking. */
  private holdThinking = false;
  private activeTool: string | null = null;
  private fillerTimers: ReturnType<typeof setTimeout>[] = [];
  private fillersSpokenThisTurn: string[] = [];
  private recentFillers: string[] = [];
  private reconnects = 0;
  private swapping = false;
  private connecting = false;
  private reconnecting = false;
  private refreshing = false;
  private pendingRefresh = false;
  private memory: Array<{ role: "user" | "assistant"; text: string }> = [];
  private speakWatch: ReturnType<typeof setTimeout> | null = null;
  private readonly toolTimeoutMs: number;

  constructor(private h: RealtimeHandlers, opts: RealtimeSessionOptions = {}) {
    this.toolTimeoutMs = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  }

  async start(opts: { greeting?: string | null }) {
    this.stopped = false;
    this.starting = true;
    this.connecting = true;
    this.setPhase(nextMandyPhase(this.phase, { type: "connect_start" }));
    try {
      const grant = await this.h.fetchGrant("session");
      if (!grant?.token || !grant.url || !grant.session) throw new Error("No voice session.");
      this.rememberTools(grant.session);
      await this.openSocket(grant);
      this.opened = true;
      this.armRefresh(grant.expires_at);
      await this.startMic();
      this.send(sessionUpdateMessage(grant.session));
      await this.waitForSession();
      if (this.stopped) return;
      this.h.onConnection?.("live");
      if (opts.greeting) {
        this.reply = opts.greeting;
        this.remember("assistant", opts.greeting);
        this.h.onReply(opts.greeting);
        this.send(forceMessageItem(opts.greeting));
        this.setPhase("speaking");
      } else {
        this.setPhase(nextMandyPhase(this.phase, { type: "session_live" }));
      }
    } finally {
      this.starting = false;
      this.connecting = false;
    }
  }

  stop() {
    this.stopped = true;
    this.generation++;
    this.clearFillers();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.speakWatch) clearTimeout(this.speakWatch);
    this.speakWatch = null;
    this.stopMic?.();
    this.stopMic = null;
    this.player?.stop();
    this.swapping = true;
    try { this.ws?.close(); } catch { /* already closed */ }
    this.swapping = false;
    this.ws = null;
    this.h.onLevel(0);
    this.h.onWorking?.(null);
  }

  /**
   * Stop the current response without hanging up. response.cancel, drop
   * playback, abandon the in-flight tool, and ignore whatever comes back late.
   */
  interrupt() {
    if (this.stopped || this.phase === "disconnected") return;
    this.generation++;
    this.ignoreAudio = true;
    this.holdThinking = false;
    this.clearFillers();
    this.calls = [];
    this.turnDone = false;
    this.activeTool = null;
    this.h.onWorking?.(null);
    this.player?.stop();
    this.send(responseCancelMessage());
    this.bargeLatched = false;
    if (this.speakWatch) clearTimeout(this.speakWatch);
    this.speakWatch = null;
    this.setPhase("listening");
  }

  /** Fresh token after a drop. Recent turns are written back into the new session. */
  reconnect() {
    this.reconnects = 0;
    void this.reconnectWithToken();
  }

  quiet() {
    this.player?.stop();
    if (this.phase === "speaking" || this.phase === "greeting") this.setPhase("listening");
  }

  speakLine(text: string) {
    this.speakForced(text);
  }

  sendUserText(text: string) {
    const t = text.trim();
    if (!t || this.stopped) return;
    if (this.phase === "speaking" || this.phase === "thinking" || this.phase === "greeting") this.interrupt();
    this.heard = t;
    this.remember("user", t);
    this.h.onHeard(t, true);
    this.send(userTextMessage(t));
    this.send(responseCreateMessage());
    this.setPhase("thinking");
  }

  private setPhase(phase: MandyPhase) {
    const prev = this.phase;
    this.phase = phase;
    this.h.onPhase(phase);
    if (phase === "listening" && prev !== "listening" && this.pendingRefresh && !this.refreshing && !this.stopped) {
      void this.refreshToken();
    }
  }

  private remember(role: "user" | "assistant", text: string) {
    const t = text.trim().slice(0, 300);
    if (!t) return;
    const last = this.memory[this.memory.length - 1];
    if (last && last.role === role && last.text === t) return;
    this.memory.push({ role, text: t });
    while (this.memory.length > 8) this.memory.shift();
  }

  private rememberTools(session: { tools?: Array<{ name?: string }> }) {
    this.allowed = new Set((session.tools ?? []).map((t) => String(t.name ?? "")).filter(Boolean));
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private trace(kind: string, detail: Record<string, unknown>) {
    console.info("[mandy-realtime]", kind, detail);
    this.h.onTrace?.(kind, detail);
  }

  private openSocket(grant: RealtimeGrant) {
    const url = this.conversationId ? withConversation(grant.url, this.conversationId) : grant.url;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url, [`xai-client-secret.${grant.token}`]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error("Voice link timed out."));
      }, 8000);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Voice link failed."));
      };
      ws.onclose = (ev: CloseEvent) => {
        const info = closeTrace(
          { code: ev.code, reason: String(ev.reason || ""), wasClean: ev.wasClean },
          { phase: this.phase, tool: this.activeTool },
        );
        this.trace("socket_close", info);
        if (this.stopped || this.swapping || this.connecting) return;
        if (ws !== this.ws) return;
        if (!this.opened && this.reconnects === 0) return;
        if (shouldAutoReconnect({ userStopped: this.stopped, swapping: this.swapping, attempts: this.reconnects })) {
          this.reconnects += 1;
          void this.reconnectWithToken();
          return;
        }
        this.failLink();
      };
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  private failLink() {
    this.clearFillers();
    this.player?.stop();
    this.activeTool = null;
    this.h.onWorking?.(null);
    this.h.onConnection?.("disconnected");
    this.setPhase("disconnected");
  }

  private async reconnectWithToken() {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this.connecting = true;
    this.opened = false;
    this.clearFillers();
    this.player?.stop();
    this.h.onWorking?.(null);
    this.h.onConnection?.("disconnected");
    this.setPhase("disconnected");
    try {
      const grant = await this.h.fetchGrant("session");
      if (this.stopped || !grant?.token) throw new Error("no token");
      this.swapping = true;
      try { this.ws?.close(); } catch { /* swap */ }
      this.swapping = false;
      this.rememberTools(grant.session);
      await this.openSocket(grant);
      this.opened = true;
      this.send(sessionUpdateMessage(grant.session));
      await this.waitForSession();
      for (const msg of historySeedMessages(this.memory)) this.send(msg);
      this.armRefresh(grant.expires_at);
      this.reconnects = 0;
      this.h.onConnection?.("live");
      this.setPhase("listening");
    } catch {
      this.swapping = false;
      if (!this.stopped) this.failLink();
    } finally {
      this.connecting = false;
      this.reconnecting = false;
    }
  }

  private armRefresh(expiresAt?: number) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const ms = expiresAt && expiresAt * 1000 > Date.now()
      ? expiresAt * 1000 - Date.now() - 20_000
      : 280_000;
    this.refreshTimer = setTimeout(() => { void this.refreshToken(); }, Math.max(5_000, ms));
  }

  private async refreshToken() {
    if (this.stopped || this.refreshing || this.reconnecting) return;
    if (this.executing) { this.pendingRefresh = true; return; }
    if (this.phase !== "listening") {
      this.pendingRefresh = true;
      return;
    }
    this.refreshing = true;
    this.pendingRefresh = false;
    this.connecting = true;
    try {
      const grant = await this.h.fetchGrant("session");
      if (this.stopped || !grant?.token) return;
      if (this.phase !== "listening") {
        this.pendingRefresh = true;
        return;
      }
      this.swapping = true;
      this.opened = false;
      try { this.ws?.close(); } catch { /* swapping */ }
      this.swapping = false;
      this.rememberTools(grant.session);
      await this.openSocket(grant);
      this.opened = true;
      this.send(sessionUpdateMessage(grant.session));
      await this.waitForSession();
      this.armRefresh(grant.expires_at);
    } catch {
      this.swapping = false;
      if (!this.stopped) void this.reconnectWithToken();
    } finally {
      this.connecting = false;
      this.refreshing = false;
    }
  }

  private waitForSession() {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1200);
      this.sessionUpdated = () => { clearTimeout(timer); resolve(); };
    });
  }

  private async startMic() {
    const ctx = this.h.audioContext();
    if (!ctx) throw new Error("Audio isn't available.");
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    this.player = new PcmPlayer(ctx, REALTIME_SAMPLE_RATE, () => {
      if (this.stopped || this.executing || this.calls.length) return;
      if (this.holdThinking) return;
      if (this.phase === "speaking" || this.phase === "greeting") this.setPhase(nextMandyPhase(this.phase, { type: "playback_ended" }));
    });
    const stream = await this.h.mic();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.onaudioprocess = (e) => {
      if (this.stopped || this.ws?.readyState !== WebSocket.OPEN) return;
      const data = e.inputBuffer.getChannelData(0);
      const level = rmsLevel(data);
      this.h.onLevel(level);
      const speaking = this.phase === "speaking" || this.phase === "greeting" || this.holdThinking || !!this.player?.pending;
      const gate = shouldForwardMic({ speaking, level, latched: this.bargeLatched });
      this.bargeLatched = gate.latched;
      if (!gate.forward) return;
      const down = downsampleFloat(data, ctx.sampleRate || 48000, REALTIME_SAMPLE_RATE);
      if (down.length) this.send(appendAudioMessage(floatToPcm16Base64(down)));
    };
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    this.stopMic = () => {
      node.onaudioprocess = null;
      try { node.disconnect(); source.disconnect(); mute.disconnect(); } catch { /* ignore */ }
    };
  }

  private onMessage(ev: MessageEvent) {
    if (this.stopped) return;
    if (typeof ev.data !== "string") {
      const bytes = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
      if (bytes?.length) this.onAudioBytes(bytes);
      return;
    }
    let event: Record<string, unknown>;
    try { event = JSON.parse(ev.data); } catch { return; }
    const type = String(event.type ?? "");
    if (type === "conversation.created") {
      const conv = event.conversation as { id?: string } | undefined;
      this.conversationId = String(conv?.id ?? event.conversation_id ?? this.conversationId ?? "") || null;
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      this.ignoreAudio = true;
      this.clearFillers();
      const b = bargeIn(this.phase === "thinking" && this.holdThinking ? "speaking" : this.phase);
      if (b.stopPlayback || this.holdThinking || this.player?.pending) {
        const ms = this.player?.playedMs() ?? 0;
        this.player?.stop();
        if (this.itemId) this.send(truncatePlaybackMessage(this.itemId, ms));
      }
      this.hadAudio = false;
      this.holdThinking = false;
      this.setPhase(b.phase);
      return;
    }
    if (type === "session.updated") {
      this.sessionUpdated?.();
      this.sessionUpdated = null;
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      this.hadAudio = false;
      if (!this.executing) { this.calls = []; this.turnDone = false; }
      this.setPhase(nextMandyPhase(this.phase, { type: "speech_stopped" }));
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed" || type === "conversation.item.input_audio_transcription.updated") {
      const text = String(event.transcript ?? "").trim();
      const final = type.endsWith("completed");
      if (text) {
        this.heard = text;
        if (final) this.remember("user", text);
        this.h.onHeard(text, final);
      }
      return;
    }
    if (type === "response.created") {
      this.ignoreAudio = false;
      this.hadAudio = false;
      this.reply = "";
      this.setPhase(nextMandyPhase(this.phase, { type: "response_created" }));
      return;
    }
    if (type === "response.output_item.added") {
      const item = event.item as { id?: string } | undefined;
      const id = String(event.item_id ?? item?.id ?? "");
      if (id) this.itemId = id;
      return;
    }
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const delta = String(event.delta ?? event.audio ?? "");
      if (delta) this.playB64(delta);
      return;
    }
    if (type === "response.output_audio_transcript.delta") {
      this.reply += String(event.delta ?? "");
      if (this.reply.trim()) this.h.onReply(this.reply.trim());
      return;
    }
    if (type === "response.output_audio_transcript.done") {
      const text = String(event.transcript ?? this.reply).trim();
      if (text) {
        this.reply = text;
        this.remember("assistant", text);
        this.h.onReply(text);
      }
      return;
    }
    if (type === "response.function_call_arguments.done") {
      this.calls.push({
        name: String(event.name ?? ""),
        callId: String(event.call_id ?? ""),
        args: String(event.arguments ?? "{}"),
      });
      this.setPhase(nextMandyPhase(this.phase, { type: "function_call" }));
      if (this.turnDone) void this.finishTools();
      return;
    }
    if (type === "response.done") {
      this.turnDone = true;
      if (!this.calls.length && !this.executing) {
        this.setPhase(phaseAfterResponseDone({ hadAudio: this.hadAudio, pendingTools: 0, playbackPending: !!this.player?.pending }));
        return;
      }
      void this.finishTools();
      return;
    }
    if (type === "error") {
      const msg = String((event.error as { message?: string } | undefined)?.message ?? event.message ?? "").trim();
      this.trace("server_error", { message: msg.slice(0, 240) });
      if (msg && !/cancel/i.test(msg)) this.h.onReply(msg.slice(0, 240));
    }
  }

  private playB64(b64: string) {
    if (this.ignoreAudio) return;
    this.hadAudio = true;
    this.player?.pushBase64(b64);
    if (this.holdThinking) return;
    this.setPhase(nextMandyPhase(this.phase, { type: "audio_out" }));
  }

  private onAudioBytes(bytes: Uint8Array) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    this.playB64(btoa(bin));
  }

  private speakForced(text: string, opts?: { holdThinking?: boolean }) {
    const t = text.trim();
    if (!t || this.stopped) return;
    this.ignoreAudio = false;
    this.holdThinking = !!opts?.holdThinking;
    this.reply = t;
    this.remember("assistant", t);
    this.h.onReply(t);
    this.send(forceMessageItem(t));
    if (this.speakWatch) clearTimeout(this.speakWatch);
    if (opts?.holdThinking) return;
    this.setPhase("speaking");
    this.speakWatch = setTimeout(() => {
      if (this.stopped || this.executing || this.holdThinking) return;
      if (this.phase === "speaking" && !this.player?.pending) this.setPhase("listening");
    }, 4000);
  }

  private clearFillers() {
    for (const t of this.fillerTimers) clearTimeout(t);
    this.fillerTimers = [];
  }

  /** One varied line at ~1.5s, then "Still on it…" at ~6s. Cleared by Stop and by a fast return. */
  private armFillers(tool: string, args: Record<string, unknown>, gen: number, started: number) {
    this.clearFillers();
    this.fillersSpokenThisTurn = [];
    const tick = () => {
      if (gen !== this.generation || this.stopped) return;
      const line = nextWorkingFiller({
        tool,
        args,
        elapsedMs: Date.now() - started,
        spokenThisTurn: this.fillersSpokenThisTurn,
        recent: this.recentFillers,
      });
      if (!line) return;
      this.fillersSpokenThisTurn.push(line);
      this.recentFillers.push(line);
      while (this.recentFillers.length > 6) this.recentFillers.shift();
      this.speakForced(line, { holdThinking: true });
    };
    this.fillerTimers.push(setTimeout(tick, FILLER_FIRST_MS));
    this.fillerTimers.push(setTimeout(tick, FILLER_SECOND_MS));
  }

  private async finishTools() {
    if (this.executing || !this.turnDone || !this.calls.length) return;
    const gen = this.generation;
    this.executing = true;
    const batch = this.calls.splice(0);
    this.turnDone = false;
    const results: MandyResult[] = [];
    try {
      for (const call of batch) {
        if (gen !== this.generation || this.stopped) return;
        const result = await this.runTool(call, gen);
        if (!result || gen !== this.generation || this.stopped) return;
        results.push(result);
        if (result.choices?.length || result.confirm) {
          this.player?.stop();
          this.ignoreAudio = true;
          this.send(responseCancelMessage());
        }
        if (call.callId) this.send(functionCallOutputMessage(call.callId, result));
        if (result.choices?.length) this.h.onChoices(result.choices);
        if (result.confirm) this.h.onConfirm(result.confirm);
        if (OPEN_QUOTE.test(call.name) && result.ok) void this.refreshToolsAfterNavigation();
      }
      if (gen !== this.generation || this.stopped) return;
      const plan = replyPlan(batch.map((c, i) => ({ action: c.name, result: results[i] })), this.heard);
      const say = spokenToolText(results);
      if (plan === "speak" && say) {
        if (this.fillersSpokenThisTurn.length) this.player?.stop();
        if (say !== this.reply) this.speakForced(say);
        else if (!this.player?.pending) this.setPhase("listening");
      } else if (plan === "continue") {
        if (batch.some((c) => OPEN_QUOTE.test(c.name))) await this.refreshToolsAfterNavigation();
        await this.player?.whenDrained();
        if (!this.stopped && gen === this.generation) {
          this.send(responseCreateMessage());
          this.setPhase("thinking");
        }
      } else {
        this.setPhase(phaseAfterResponseDone({ hadAudio: this.hadAudio, pendingTools: 0, playbackPending: !!this.player?.pending }));
      }
    } finally {
      this.clearFillers();
      this.holdThinking = false;
      this.executing = false;
      this.activeTool = null;
      if (gen === this.generation) this.h.onWorking?.(null);
      if (gen === this.generation && this.turnDone && this.calls.length && !this.stopped) void this.finishTools();
      else if (gen === this.generation && this.phase === "listening" && this.pendingRefresh && !this.stopped) void this.refreshToken();
    }
  }

  private async runTool(call: { name: string; callId: string; args: string }, gen: number): Promise<MandyResult | null> {
    const started = Date.now();
    this.activeTool = call.name;
    this.trace("tool_start", { name: call.name });
    this.h.onWorking?.(workingStepLabel(call.name));
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.args || "{}"); } catch { args = {}; }
    if (call.name === "report_problem" && gen === this.generation) this.speakForced(HANDOFF_LOGGED);
    this.armFillers(call.name, args, gen, started);
    const timeoutSay: MandyResult = { ok: false, message: TOOL_TIMEOUT_SAY };
    const settled = await settleWithin(this.executeTool(call.name, call.args), this.toolTimeoutMs, timeoutSay);
    this.clearFillers();
    const ms = Date.now() - started;
    if (gen !== this.generation || this.stopped) {
      this.trace("tool_finish", { name: call.name, ms, abandoned: true });
      return null;
    }
    let result = settled.value;
    if (result.choices?.length || result.confirm) {
      result = { ...result, message: spokenPanelLine(result.message, result.confirm ? "confirm" : "choices") };
    }
    this.trace("tool_finish", { name: call.name, ms, ok: result.ok, timedOut: settled.timedOut });
    return result;
  }

  private async executeTool(name: string, rawArgs: string): Promise<MandyResult> {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArgs || "{}"); } catch { args = {}; }
    if (!this.heard) {
      const gen = this.generation;
      for (let i = 0; i < 8 && !this.heard && !this.stopped && gen === this.generation; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const registered = this.h.listToolNames();
    const available = this.allowed.size ? registered.filter((n) => this.allowed.has(n)) : registered;
    const fb = fallbackRoute({ transcript: this.heard, proposed: name, available });
    if (fb.speak && !fb.action) return { ok: true, message: fb.speak };
    const tool = fb.action || name;
    const toolArgs = fb.action && fb.action !== name ? { ...args, ...fb.args } : args;
    if (this.allowed.size && !this.allowed.has(tool)) return { ok: false, message: "I can't do that from your account." };
    const ready = await this.h.ensureHandler(tool);
    if (!ready) return { ok: false, message: "I can't do that on this screen." };
    try {
      return await this.h.execute(tool, toolArgs);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "That failed." };
    }
  }

  /** Pull the newly registered quote tools into the session without blocking the first sentence. */
  private async refreshToolsAfterNavigation() {
    const before = this.h.listToolNames().slice().sort().join(",");
    for (let i = 0; i < 40 && !this.stopped; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (this.h.listToolNames().slice().sort().join(",") !== before) break;
    }
    if (this.stopped) return;
    try {
      const grant = await this.h.fetchGrant("tools");
      if (!grant?.session || this.stopped) return;
      this.rememberTools(grant.session);
      this.send(sessionUpdateMessage(grant.session));
    } catch { /* the next turn still has the previous tool list */ }
  }
}

function withConversation(url: string, id: string) {
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}conversation_id=${encodeURIComponent(id)}`;
}

class PcmPlayer {
  private next = 0;
  private nodes: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private drain: (() => void) | null = null;

  constructor(private ctx: AudioContext, private rate: number, private onDrain: () => void) {}

  get pending() {
    return this.nodes.length > 0 || this.ctx.currentTime + 0.03 < this.next;
  }

  playedMs() {
    if (!this.startedAt) return 0;
    return Math.max(0, (this.ctx.currentTime - this.startedAt) * 1000);
  }

  pushBase64(b64: string) {
    const floats = base64Pcm16ToFloat32(b64);
    if (!floats.length) return;
    const buf = this.ctx.createBuffer(1, floats.length, this.rate);
    buf.getChannelData(0).set(floats);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const start = Math.max(now + 0.02, this.next || now + 0.02);
    if (!this.nodes.length && this.next < now) this.startedAt = start;
    src.start(start);
    this.next = start + buf.duration;
    this.nodes.push(src);
    src.onended = () => {
      this.nodes = this.nodes.filter((n) => n !== src);
      if (!this.pending) {
        this.drain?.();
        this.drain = null;
        this.onDrain();
      }
    };
  }

  stop() {
    for (const n of this.nodes) {
      try { n.onended = null; n.stop(); } catch { /* already stopped */ }
    }
    this.nodes = [];
    this.next = 0;
    this.startedAt = 0;
    this.drain?.();
    this.drain = null;
  }

  whenDrained() {
    if (!this.pending) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const prev = this.drain;
      this.drain = () => { prev?.(); resolve(); };
    });
  }
}

/**
 * Dashboard Mandy speech-to-speech session.
 * Audio goes to wss://api.x.ai/v1/realtime with an ephemeral token from
 * mandy-realtime. Tools run through the dock's existing handlers.
 */
import type { MandyChoice, MandyResult } from "./actions";
import {
  REALTIME_SAMPLE_RATE,
  appendAudioMessage,
  bargeIn,
  base64Pcm16ToFloat32,
  downsampleFloat,
  floatToPcm16Base64,
  forceMessageItem,
  functionCallOutputMessage,
  nextMandyPhase,
  phaseAfterResponseDone,
  replyPlan,
  responseCreateMessage,
  rmsLevel,
  sessionUpdateMessage,
  spokenToolText,
  truncatePlaybackMessage,
  userTextMessage,
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
  onHeard: (text: string) => void;
  onReply: (text: string) => void;
  onChoices: (choices: MandyChoice[]) => void;
  onConfirm: (confirm: ConfirmCard | null) => void;
  onFatal: (message: string) => void;
  audioContext: () => AudioContext | null;
  mic: () => Promise<MediaStream>;
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
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private opened = false;

  constructor(private h: RealtimeHandlers) {}

  async start(opts: { greeting?: string | null }) {
    this.stopped = false;
    this.starting = true;
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
      if (opts.greeting) {
        this.reply = opts.greeting;
        this.h.onReply(opts.greeting);
        this.send(forceMessageItem(opts.greeting));
        this.setPhase("speaking");
      } else {
        this.setPhase(nextMandyPhase(this.phase, { type: "session_live" }));
      }
    } finally {
      this.starting = false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.stopMic?.();
    this.stopMic = null;
    this.player?.stop();
    try { this.ws?.close(); } catch { /* already closed */ }
    this.ws = null;
    this.h.onLevel(0);
  }

  quiet() {
    this.player?.stop();
    if (this.phase === "speaking" || this.phase === "greeting") this.setPhase("listening");
  }

  speakLine(text: string) {
    const t = text.trim();
    if (!t || this.stopped) return;
    this.reply = t;
    this.h.onReply(t);
    this.send(forceMessageItem(t));
    this.setPhase("speaking");
  }

  sendUserText(text: string) {
    const t = text.trim();
    if (!t || this.stopped) return;
    this.heard = t;
    this.h.onHeard(t);
    this.send(userTextMessage(t));
    this.send(responseCreateMessage());
    this.setPhase("thinking");
  }

  private setPhase(phase: MandyPhase) {
    this.phase = phase;
    this.h.onPhase(phase);
  }

  private rememberTools(session: { tools?: Array<{ name?: string }> }) {
    this.allowed = new Set((session.tools ?? []).map((t) => String(t.name ?? "")).filter(Boolean));
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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
      ws.onclose = () => {
        if (!this.stopped && this.opened && !this.starting && ws === this.ws) this.h.onFatal("Mandy's voice link dropped. Tap the mic to try again.");
      };
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  private armRefresh(expiresAt?: number) {
    if (!expiresAt) return;
    const ms = expiresAt * 1000 - Date.now() - 20_000;
    if (ms < 5_000) return;
    this.refreshTimer = setTimeout(() => { void this.refreshToken(); }, ms);
  }

  private async refreshToken() {
    if (this.stopped || this.phase !== "listening") return;
    try {
      const grant = await this.h.fetchGrant("session");
      if (this.stopped || !grant?.token) return;
      this.opened = false;
      try { this.ws?.close(); } catch { /* swapping */ }
      this.rememberTools(grant.session);
      await this.openSocket(grant);
      this.opened = true;
      this.send(sessionUpdateMessage(grant.session));
      this.armRefresh(grant.expires_at);
    } catch {
      if (!this.stopped) this.h.onFatal("Mandy's voice link dropped. Tap the mic to try again.");
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
      this.h.onLevel(rmsLevel(data));
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
      const b = bargeIn(this.phase);
      if (b.stopPlayback) {
        const ms = this.player?.playedMs() ?? 0;
        this.player?.stop();
        if (this.itemId) this.send(truncatePlaybackMessage(this.itemId, ms));
      }
      this.hadAudio = false;
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
      if (text) { this.heard = text; this.h.onHeard(text); }
      return;
    }
    if (type === "response.created") {
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
      if (text) { this.reply = text; this.h.onReply(text); }
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
      if (msg) this.h.onReply(msg.slice(0, 240));
    }
  }

  private playB64(b64: string) {
    this.hadAudio = true;
    this.player?.pushBase64(b64);
    this.setPhase(nextMandyPhase(this.phase, { type: "audio_out" }));
  }

  private onAudioBytes(bytes: Uint8Array) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    this.playB64(btoa(bin));
  }

  private async finishTools() {
    if (this.executing || !this.turnDone || !this.calls.length) return;
    this.executing = true;
    const batch = this.calls.splice(0);
    this.turnDone = false;
    const results: MandyResult[] = [];
    try {
      for (const call of batch) {
        const result = await this.runTool(call.name, call.args);
        results.push(result);
        if (call.callId) this.send(functionCallOutputMessage(call.callId, result));
        if (result.choices?.length) this.h.onChoices(result.choices);
        if (result.confirm) this.h.onConfirm(result.confirm);
        if (OPEN_QUOTE.test(call.name) && result.ok) void this.refreshToolsAfterNavigation();
      }
      const plan = replyPlan(batch.map((c, i) => ({ action: c.name, result: results[i] })), this.heard);
      const say = spokenToolText(results);
      if (plan === "speak" && say) {
        this.reply = say;
        this.h.onReply(say);
        this.send(forceMessageItem(say));
        this.setPhase("speaking");
      } else if (plan === "continue") {
        if (batch.some((c) => OPEN_QUOTE.test(c.name))) await this.refreshToolsAfterNavigation();
        await this.player?.whenDrained();
        if (!this.stopped) {
          this.send(responseCreateMessage());
          this.setPhase("thinking");
        }
      } else {
        this.setPhase(phaseAfterResponseDone({ hadAudio: this.hadAudio, pendingTools: 0, playbackPending: !!this.player?.pending }));
      }
    } finally {
      this.executing = false;
      if (this.turnDone && this.calls.length) void this.finishTools();
    }
  }

  private async runTool(name: string, rawArgs: string): Promise<MandyResult> {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArgs || "{}"); } catch { args = {}; }
    if (this.allowed.size && !this.allowed.has(name)) return { ok: false, message: "I can't do that from your account." };
    const ready = await this.h.ensureHandler(name);
    if (!ready) return { ok: false, message: "I can't do that on this screen." };
    try {
      return await this.h.execute(name, args);
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

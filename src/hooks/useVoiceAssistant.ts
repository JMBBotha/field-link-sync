import { useCallback, useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { supabase } from "@/integrations/supabase/client";
import type { Structured } from "@/components/admin/nl/ResultTable";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface PendingConfirmation {
  /** nl_audit_log row id of the queued write — used to make the modal one-shot. */
  id?: string;
  tool_name: string;
  args: Record<string, unknown>;
}


export type VoiceStatus = "idle" | "connecting" | "live" | "ended" | "error";

interface PollResult {
  id: string;
  tool_name: string;
  rows: Record<string, unknown>[];
  summary: string;
}

/**
 * Drives a Vapi voice session for the operations assistant.
 *
 * All tool execution happens server-side in the `nl-voice-tool` webhook (the
 * same shared registry the text assistant uses), so this hook only handles
 * audio, transcript, and polling for the structured results / pending write
 * confirmations that the webhook recorded.
 */
export function useVoiceAssistant() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [results, setResults] = useState<Structured[]>([]);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);

  const vapiRef = useRef<Vapi | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const seenResultIds = useRef<Set<string>>(new Set());
  /** Pending writes already answered on screen — never surfaced again. */
  const resolvedPendingIds = useRef<Set<string>>(new Set());
  const lastPendingIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const poll = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const { data, error: fnError } = await supabase.functions.invoke("nl-voice-session", {
      body: { action: "poll", session_id: sessionId },
    });
    if (fnError || (data as { error?: string })?.error) return;
    const payload = data as { results?: PollResult[]; pending?: PendingConfirmation | null };

    const fresh = (payload.results ?? []).filter((r) => !seenResultIds.current.has(r.id));
    if (fresh.length) {
      fresh.forEach((r) => seenResultIds.current.add(r.id));
      setResults((prev) => [...prev, ...fresh.map((r) => ({ tool_name: r.tool_name, rows: r.rows }))]);
    }
    const next = payload.pending ?? null;
    const nextId = next?.id ?? null;
    if (next && nextId && resolvedPendingIds.current.has(nextId)) {
      setPending(null);
      return;
    }
    lastPendingIdRef.current = nextId;
    setPending(next);
  }, []);


  const stop = useCallback(() => {
    stopPolling();
    try {
      vapiRef.current?.stop();
    } catch {
      /* already stopped */
    }
    vapiRef.current = null;
    setAssistantSpeaking(false);
    setStatus((s) => (s === "error" ? s : "ended"));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("nl-voice-session", {
        body: { action: "start" },
      });
      if (fnError) throw new Error(fnError.message || "Could not start the voice session");
      const payload = data as {
        error?: string;
        publicKey?: string;
        sessionId?: string;
        assistant?: Record<string, unknown>;
        assistantId?: string;
        assistantOverrides?: Record<string, unknown>;
      };
      if (payload?.error) throw new Error(payload.error);
      if (!payload.publicKey || !payload.sessionId || (!payload.assistant && !payload.assistantId)) {
        throw new Error("Voice mode is not configured yet.");
      }

      sessionIdRef.current = payload.sessionId;
      seenResultIds.current = new Set();
      setTranscript([]);
      setResults([]);
      setPending(null);

      const vapi = new Vapi(payload.publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => setStatus("live"));
      vapi.on("call-end", () => {
        stopPolling();
        setAssistantSpeaking(false);
        setStatus("ended");
        void poll();
      });
      vapi.on("speech-start", () => setAssistantSpeaking(true));
      vapi.on("speech-end", () => setAssistantSpeaking(false));
      vapi.on("error", (e: unknown) => {
        // Vapi surfaces API rejections as { error: { message } } or as a Response-like
        // object; unwrap it so the operator sees the real reason (billing, config…).
        const anyErr = e as {
          message?: string;
          errorMsg?: string;
          error?: { message?: string | string[]; error?: string } | string;
        } | null;
        const inner = typeof anyErr?.error === "object" ? anyErr?.error : undefined;
        const innerMsg = Array.isArray(inner?.message) ? inner?.message.join(", ") : inner?.message;
        const message =
          innerMsg ||
          (typeof anyErr?.error === "string" ? anyErr.error : undefined) ||
          anyErr?.errorMsg ||
          (e instanceof Error ? e.message : undefined) ||
          "The voice call failed.";
        console.error("[useVoiceAssistant] vapi error", e);
        setError(message);
        setStatus("error");
        stopPolling();
      });

      vapi.on("message", (msg: Record<string, any>) => {
        if (msg?.type !== "transcript" || !msg?.transcript) return;
        const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
        const final = msg.transcriptType === "final";
        setTranscript((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === role && !last.final) {
            next[next.length - 1] = { role, text: msg.transcript, final };
            return next;
          }
          return [...next, { role, text: msg.transcript, final }];
        });
        // A tool almost certainly ran while the assistant was talking.
        if (role === "assistant" && final) void poll();
      });

      if (payload.assistantId) {
        // Saved Vapi assistant (VAPI_ASSISTANT_ID) + session-scoped overrides.
        await vapi.start(payload.assistantId as never, payload.assistantOverrides as never);
      } else {
        await vapi.start(payload.assistant as never);
      }
      pollRef.current = window.setInterval(() => void poll(), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start voice mode");
      setStatus("error");
      stopPolling();
    }
  }, [poll]);

  const toggleMute = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    const next = !muted;
    vapi.setMuted(next);
    setMuted(next);
  }, [muted]);

  /** Called after the on-screen confirmation modal runs the write. */
  const clearPending = useCallback((spoken?: string, opts?: { id?: string; status?: "executed" | "cancelled" }) => {
    const id = opts?.id ?? lastPendingIdRef.current ?? undefined;
    if (id) resolvedPendingIds.current.add(id);
    setPending(null);
    if (spoken) setTranscript((prev) => [...prev, { role: "assistant", text: spoken, final: true }]);
    // Write a terminal row server-side so the poll (and the voice agent) treat
    // this write as finished — otherwise the modal comes straight back.
    const sessionId = sessionIdRef.current;
    if (id && sessionId) {
      void supabase.functions.invoke("nl-voice-session", {
        body: { action: "resolve", session_id: sessionId, pending_id: id, status: opts?.status ?? "cancelled" },
      }).then(() => poll());
      return;
    }
    void poll();
  }, [poll]);


  useEffect(() => () => {
    stopPolling();
    try {
      vapiRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  return {
    status,
    error,
    transcript,
    results,
    pending,
    assistantSpeaking,
    muted,
    start,
    stop,
    toggleMute,
    clearPending,
    refresh: poll,
  };
}

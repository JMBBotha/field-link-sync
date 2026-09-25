/**
 * Mandy dock — Grok tool-calling voice assistant.
 *
 * Turn: mic (WavRecorder + VAD) → xAI STT (voice-quote-parse/transcribe) →
 * mandy-agent (Grok picks a tool) → browser runs the tool via the action
 * registry under the user's session → result back to Grok (max 4 steps) →
 * ONE spoken reply (xAI TTS, browser speech as fallback).
 *
 * Voice rules enforced here: silent while working (spinner only), exactly one
 * utterance per turn, one audio element, cancel before a new turn, dedupe.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, MicOff, Send, Volume2, VolumeX, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { WavRecorder } from "@/lib/wavRecorder";
import { getAssistantContext, setAssistantContext } from "@/stores/assistantContextStore";
import { useMandyDock, useMandyRegistry, useRegisterMandyActions } from "@/lib/mandy/registry";
import { CONFIRM_REQUIRED, toolsFor, type MandyChoice, type MandyResult } from "@/lib/mandy/actions";
import { routeVoiceCommand, gateRoute } from "@/lib/mandy/router";
import { gateDecision, getMandyQuoteStatus } from "@/lib/mandy/gate";
import { honestMessage, routeReached } from "@/lib/mandy/verify";
import { formatForSpeech, formatReplyText } from "@/lib/mandy/speech";
import { useWorkflowMandyActions } from "@/components/mandy/MandyWorkflowActions";
import { clientDisplayName, isHighConfidence, rankClientHits } from "@/lib/voiceClientMatch";
import { createDraftQuoteForCustomer } from "@/lib/createDraftQuote";
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";
import { ADD_NEW_CLIENT_CHOICE, buildFindClientResult } from "@/lib/mandy/clientChoices";

const MAX_STEPS = 4;
type Phase = "idle" | "listening" | "hearing" | "working";
type Msg = Record<string, unknown>;

const QUOTE_TOOLS_PROBE = "read_quote_total";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── global (non-quote) actions ───────────── */
/** Navigate, or — when the target is already the current route — force a refetch. */
export function useMandyGo() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const registry = useMandyRegistry();
  return (path: string) => {
    const here = window.location.pathname + window.location.search;
    if (routeReached(path, window.location.pathname, window.location.search) || here === path) {
      void qc.invalidateQueries();
      void registry?.get("__refresh_quote")?.({});
      return;
    }
    navigate(path);
  };
}

function useGlobalMandyActions() {
  const go = useMandyGo();
  const navigate = go;
  const { user } = useAuth();

  const openQuote = (q: { id: string; quote_number?: string | null; customer_name?: string | null }): MandyResult => {
    const route = `/admin/estimates/${q.id}`;
    go(route);
    return { ok: true, message: `Opened ${q.quote_number || "the quote"}${q.customer_name ? ` for ${q.customer_name}` : ""}.`, data: { quote_id: q.id, route } };
  };

  useRegisterMandyActions({
    open_last_quote: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id, quote_number, customer_name, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return { ok: false, message: `Could not load quotes: ${error.message}` };
      if (!data?.length) return { ok: false, message: "No quotes found." };
      return openQuote(data[0]);
    },
    open_quote: async ({ ref, client, quote_id }) => {
      if (quote_id) {
        const { data } = await supabase.from("quotes").select("id, quote_number, customer_name").eq("id", quote_id).maybeSingle();
        return data ? openQuote(data) : { ok: false, message: "That quote is no longer available." };
      }
      let q = supabase.from("quotes").select("id, quote_number, customer_name, created_at").order("created_at", { ascending: false }).limit(6);
      if (ref) q = q.ilike("quote_number", `%${String(ref).replace(/\s+/g, "").replace(/[%_]/g, "")}%`);
      else if (client) q = q.ilike("customer_name", `%${String(client).trim().replace(/[%_]/g, "")}%`);
      else return { ok: false, message: "Which quote? Give a number or a client name." };
      const { data, error } = await q;
      if (error) return { ok: false, message: error.message };
      if (!data?.length) return { ok: false, message: `No quote matching ${ref || client}.` };
      if (data.length === 1) return openQuote(data[0]);
      return {
        ok: true,
        message: `${data.length} quotes match. Waiting for the user to tap one.`,
        choices: data.map((d) => ({ label: `${d.quote_number} · ${d.customer_name || "no client"}`, action: "open_quote", args: { quote_id: d.id } })),
      };
    },
    find_client: async ({ query }) => {
      const q = String(query || "").trim();
      if (!q) return { ok: false, message: "No name given.", choices: [ADD_NEW_CLIENT_CHOICE] };
      const { data, error } = await supabase.rpc("search_customers", { search_term: q, max_results: 10 });
      const ranked = rankClientHits(q, (error ? [] : data || []) as CustomerSearchResult[]);
      const exact = ranked.length === 1 && isHighConfidence(q, ranked[0]);
      const res = buildFindClientResult(q, ranked.map((c) => ({ id: c.id, name: clientDisplayName(c) })), exact);
      if (res.openClientId) {
        const name = String((res.data as any)?.name || "");
        setAssistantContext({ selected_customer_id: res.openClientId, selected_customer_name: name });
        navigate(`/admin/customers/${res.openClientId}`);
      }
      const { openClientId: _o, ...out } = res;
      return out;
    },
    open_client: async ({ client_id, name }) => {
      setAssistantContext({ selected_customer_id: client_id, selected_customer_name: name });
      navigate(`/admin/customers/${client_id}`);
      return { ok: true, message: `Opened ${name}.`, data: { client_id, name, route: `/admin/customers/${client_id}` } };
    },
    add_new_client: async () => {
      navigate("/admin/customers?new=1");
      return { ok: true, message: "Opened clients — add the new client there.", data: { route: "/admin/customers?new=1" } };
    },
    select_client: async ({ client_id, name }) => {
      setAssistantContext({ selected_customer_id: client_id, selected_customer_name: name });
      return { ok: true, message: `Selected ${name}. Say “new quote” to start one.` };
    },
    create_quote_for_client: async ({ client_id }) => {
      if (!user?.id) return { ok: false, message: "Not signed in." };
      const { data: c } = await supabase.from("customers").select("id, name, company_name").eq("id", client_id).maybeSingle();
      if (!c) return { ok: false, message: "That client was not found." };
      const id = await createDraftQuoteForCustomer(user.id, c.id, c.name || c.company_name);
      navigate(`/admin/estimates/${id}`);
      return { ok: true, message: `Created a new draft quote for ${c.name || c.company_name} and opened it.`, data: { quote_id: id, route: `/admin/estimates/${id}` } };
    },
  });
}

/* ───────────── speech out: exactly one utterance per turn ───────────── */
function useSpeaker(muted: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const [ttsCalls, setTtsCalls] = useState(0);

  const cancel = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(async (text: string) => {
    cancel();
    const t = formatForSpeech(text).trim();
    if (!t || muted) return;
    const now = Date.now();
    if (lastRef.current && lastRef.current.text === t && now - lastRef.current.at < 4000) return; // dedupe
    lastRef.current = { text: t, at: now };
    setTtsCalls((n) => n + 1);
    const { data, error } = await supabase.functions.invoke("mandy-agent", { body: { action: "tts", text: t } });
    const d = data as { audio_base64?: string; mime?: string; spoken?: string } | null;
    if (!error && d?.audio_base64) {
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = `data:${d.mime || "audio/mpeg"};base64,${d.audio_base64}`;
      try { await audioRef.current.play(); return; } catch { /* fall through */ }
    }
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(d?.spoken || t);
      const voices = window.speechSynthesis.getVoices();
      u.voice = voices.find((v) => /en-ZA/i.test(v.lang)) || voices.find((v) => /en-GB/i.test(v.lang)) || null;
      window.speechSynthesis.speak(u);
    }
  }, [cancel, muted]);

  return { speak, cancel, ttsCalls };
}

export default function MandyDock() {
  const { user } = useAuth();
  const { open, setOpen } = useMandyDock();
  const registry = useMandyRegistry();
  useGlobalMandyActions();
  useWorkflowMandyActions();

  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [typed, setTyped] = useState("");
  const [muted, setMuted] = useState(false);
  const [choices, setChoices] = useState<MandyChoice[]>([]);
  const [confirm, setConfirm] = useState<{ summary: string; run: () => Promise<MandyResult> } | null>(null);
  const { speak, cancel } = useSpeaker(muted);

  const historyRef = useRef<Msg[]>([]);
  const busyRef = useRef(false);
  const recRef = useRef<WavRecorder | null>(null);

  const audit = (tool: string, args: unknown, r: MandyResult) => {
    void supabase.functions.invoke("mandy-agent", { body: { action: "audit", tool, args, result: { message: r.message, data: r.data ?? null }, ok: r.ok } });
  };

  const execute = useCallback(async (name: string, args: Record<string, any>): Promise<MandyResult> => {
    const h = registry?.get(name);
    if (!h) return { ok: false, message: `${name} is not available on this screen.` };
    try {
      const r = await h(args || {});
      if (CONFIRM_REQUIRED.has(name) && r.ok && !r.confirm && !r.choices) {
        // Safety: destructive actions must come back as a confirm card.
        return { ok: false, message: `${name} needs an on-screen confirmation and was not run.` };
      }
      const route = (r.data as any)?.route;
      if (r.ok && !r.choices && !r.confirm && typeof route === "string" && r.verified === undefined) {
        await sleep(60);
        r.verified = routeReached(route, window.location.pathname, window.location.search);
      }
      audit(name, args, r);
      if (/^(open_quote|open_last_quote|create_quote_for_client)$/.test(name) && r.ok && !r.choices) {
        // Wait for the opened page to register its quote actions.
        for (let i = 0; i < 40 && !registry?.get(QUOTE_TOOLS_PROBE); i++) await sleep(100);
      }
      return r;
    } catch (e) {
      const r = { ok: false, message: e instanceof Error ? e.message : "That failed." };
      audit(name, args, r);
      return r;
    }
  }, [registry]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTurn = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busyRef.current) return;
    busyRef.current = true;
    cancel();
    setHeard(t);
    setChoices([]);
    setConfirm(null);
    setPhase("working");
    const msgs: Msg[] = [...historyRef.current.slice(-8)];
    let final = "";
    let lastUnverified = false;
    try {
      for (let step = 0; step <= MAX_STEPS; step++) {
        const r0 = await routeVoiceCommand({
          transcript: step === 0 ? t : "",
          history: msgs,
          tools: toolsFor(registry?.names() || []),
          context: getAssistantContext() as Record<string, unknown>,
          forceText: step === MAX_STEPS,
        });
        if (step === 0) msgs.push({ role: "user", content: t });
        if (r0.error) { final = `Sorry, I couldn't reach my brain: ${r0.error}`; break; }
        if (r0.action) {
          const tier = gateDecision(r0.action, r0.confidence, { quoteStatus: getMandyQuoteStatus() });
          if (tier.kind === "block") { final = tier.reason!; break; }
          if (tier.kind === "chips") {
            // Not sure enough — never run it. One-tap chip + one-line question.
            const gate = gateRoute(r0, tier.threshold);
            setChoices([gate.choice!]);
            final = gate.question!;
            break;
          }
          let r: MandyResult;
          if (tier.kind === "confirm" && !CONFIRM_REQUIRED.has(r0.action)) {
            // Gate-level confirm (e.g. below floor): wrap the handler in a Confirm card.
            const a = r0.action, args = r0.args;
            r = { ok: true, message: `Awaiting on-screen confirmation for ${a.replace(/_/g, " ")}.`, confirm: { summary: `Run ${a.replace(/_/g, " ")}?`, run: () => execute(a, args) } };
          } else {
            r = await execute(r0.action, r0.args);
          }
          if (r.choices?.length) setChoices(r.choices);
          if (r.confirm) setConfirm(r.confirm);
          lastUnverified = r.verified === false;
          msgs.push(r0.assistantMessage!, {
            role: "tool",
            tool_call_id: r0.callId,
            content: JSON.stringify({
              ok: r.ok,
              result: honestMessage(r),
              ...(r.verified === false ? { verified_on_screen: false } : {}),
              ...(r.data ? { data: r.data } : {}),
              ...(r.choices?.length ? { choices: r.choices.map((c) => c.label) } : {}),
              ...(r.confirm ? { awaiting_confirmation: r.confirm.summary } : {}),
            }),
          });
          continue;
        }
        final = r0.text || "";
        break;
      }
    } finally {
      busyRef.current = false;
    }
    if (!final) final = "I couldn't finish that — nothing more was done.";
    if (lastUnverified && !/confirm it on screen/i.test(final)) final = honestMessage({ ok: true, message: final, verified: false });
    final = formatReplyText(final);
    historyRef.current = [...historyRef.current, { role: "user", content: t }, { role: "assistant", content: final }].slice(-8);
    setReply(final);
    setPhase("idle");
    await speak(final); // the ONE utterance of this turn
  }, [cancel, execute, registry, speak]);

  const pickChoice = async (c: MandyChoice) => {
    setChoices([]);
    setPhase("working");
    const r = await execute(c.action, c.args);
    if (r.choices?.length) setChoices(r.choices);
    if (r.confirm) setConfirm(r.confirm);
    const msg = formatReplyText(honestMessage(r));
    setReply(msg);
    setPhase("idle");
    await speak(msg);
  };

  const runConfirm = async () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    setPhase("working");
    const r = await c.run();
    audit("confirmed", { summary: c.summary }, r);
    const msg = formatReplyText(honestMessage(r));
    setReply(msg);
    setPhase("idle");
    await speak(msg);
  };

  /* ───────────── mic ───────────── */
  const stopListening = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setPhase("hearing");
    try {
      const { base64, bytes } = await rec.stop();
      if (bytes < 2048) { setPhase("idle"); return; }
      const { data, error } = await supabase.functions.invoke("voice-quote-parse", { body: { action: "transcribe", audio: base64 } });
      const text = String((data as { transcript?: string })?.transcript ?? "").trim();
      if (error || !text) { setPhase("idle"); setReply(error ? "I couldn't hear that — try again." : "Nothing was picked up."); return; }
      await runTurn(text);
    } catch {
      setPhase("idle");
    }
  }, [runTurn]);
  const stopRef = useRef(stopListening);
  stopRef.current = stopListening;

  const startListening = async () => {
    if (recRef.current || busyRef.current) return;
    cancel();
    try {
      const rec = new WavRecorder();
      await rec.start({ silenceMs: 1300, onSilence: () => void stopRef.current() });
      recRef.current = rec;
      setPhase("listening");
    } catch {
      setReply("Microphone unavailable — type instead.");
    }
  };

  useEffect(() => () => { recRef.current?.cancel(); cancel(); }, [cancel]);
  // "Voice" from the ops panel: open + start listening.
  const listenRequest = useMandyDock((s) => s.listenRequest);
  const startRef = useRef(startListening);
  startRef.current = startListening;
  useEffect(() => { if (listenRequest && open) void startRef.current(); }, [listenRequest, open]);
  useEffect(() => { if (!open) { recRef.current?.cancel(); recRef.current = null; cancel(); setPhase("idle"); } }, [open, cancel]);

  if (!user || !open) return null;

  const statusText = phase === "listening" ? "Listening…" : phase === "hearing" ? "Hearing…" : phase === "working" ? "Working…" : "Ready";

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[300px] sm:w-[340px] rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-lg print:hidden" data-testid="mandy-dock">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex h-2 w-2 rounded-full ${phase === "listening" ? "bg-destructive animate-pulse" : phase === "idle" ? "bg-primary" : "bg-primary animate-pulse"}`} />
          <span className="font-medium text-foreground">Mandy</span>
          <span className="text-muted-foreground">{statusText}</span>
          {(phase === "working" || phase === "hearing") && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMuted((m) => !m); cancel(); }} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close Mandy">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 px-3 py-2 text-sm">
        {heard && <p className="text-xs text-muted-foreground">You: “{heard}”</p>}
        {reply && <p className="text-foreground" data-testid="mandy-reply">{reply}</p>}
        {!heard && !reply && <p className="text-xs text-muted-foreground">Tap the mic and ask — e.g. “open the last quote”, “add a Samsung 24000 inverter to Main bedroom”.</p>}

        {choices.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="mandy-choices">
            {choices.map((c, i) => (
              <Button key={i} size="sm" variant="outline" className="h-auto whitespace-normal py-1 text-left text-xs" onClick={() => void pickChoice(c)}>
                {c.label}
              </Button>
            ))}
          </div>
        )}

        {confirm && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
            <p className="text-xs text-foreground">{confirm.summary}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={() => void runConfirm()}><Check className="h-3 w-3" /> Confirm</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => { setConfirm(null); setReply("Cancelled — nothing was changed."); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button
          size="icon"
          variant={phase === "listening" ? "destructive" : "default"}
          className="h-9 w-9 shrink-0"
          disabled={phase === "hearing" || phase === "working"}
          onClick={() => (phase === "listening" ? void stopListening() : void startListening())}
          aria-label={phase === "listening" ? "Stop" : "Talk"}
        >
          {phase === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = typed; setTyped(""); void runTurn(v); }}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead…" className="h-9 text-sm" disabled={phase === "working"} data-testid="mandy-input" />
          <Button type="submit" size="icon" variant="ghost" className="h-9 w-9" disabled={!typed.trim() || phase === "working"} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

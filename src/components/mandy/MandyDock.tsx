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
import { Loader2, Mic, MicOff, Send, Volume2, VolumeX, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { WavRecorder } from "@/lib/wavRecorder";
import { getAssistantContext, setAssistantContext } from "@/stores/assistantContextStore";
import { armUtteranceEnd, getMandyAudioContext, getMandyMicStream, playOnSharedAudio, releaseMandyMic, stopSharedAudio, unlockMandyVoiceFromTap, type SharedPlayback } from "@/lib/mandy/voiceUnlock";
import { useMandyDock, useMandyRegistry, useRegisterMandyActions } from "@/lib/mandy/registry";
import { CONFIRM_REQUIRED, toolsFor, type MandyChoice, type MandyResult } from "@/lib/mandy/actions";
import { routeVoiceCommand, gateRoute } from "@/lib/mandy/router";
import { gateDecision, gatePlan, getMandyQuoteStatus } from "@/lib/mandy/gate";
import { runPlanSteps, planReportText, type PlanStep } from "@/lib/mandy/quoteEdits";
import type { PlanPreview } from "@/lib/mandy/planPreview";
import { parseMultiEdit } from "@/lib/mandy/multiEdit";
import { parseLabourIntent, mapLabourTool } from "@/lib/mandy/labourParse";
import { parseInstallCommand } from "@/lib/mandy/installEdits";
import { parseQuoteIntent } from "@/lib/mandy/quoteIntent";
import { guardClaimedChange, unknownToolMessage } from "@/lib/mandy/honesty";
import { honestMessage, routeReached, finalReplyFrom } from "@/lib/mandy/verify";
import { BUILD_ID, staleWriteRefusal, useBuildStatus, checkForNewBuild } from "@/lib/buildInfo";
import { touchedPatch } from "@/lib/mandy/pronouns";
import { useMandyGo } from "@/lib/mandy/go";
import { formatForSpeech, formatReplyText } from "@/lib/mandy/speech";
import { useWorkflowMandyActions } from "@/components/mandy/MandyWorkflowActions";
import { greetThenListen } from "@/lib/mandy/greetThenListen";
import { greetingFor } from "@/lib/mandy/greetingFor";
import { clientDisplayName, isHighConfidence, rankClientHits } from "@/lib/voiceClientMatch";
import { createDraftQuoteForCustomer } from "@/lib/createDraftQuote";
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";
import { ADD_NEW_CLIENT_CHOICE, buildFindClientResult } from "@/lib/mandy/clientChoices";
import { latestQuoteQuery } from "@/lib/mandy/latestQuote";

const MAX_STEPS = 4;
type Phase = "idle" | "starting" | "greeting" | "listening" | "hearing" | "working";
type Msg = Record<string, unknown>;

const QUOTE_TOOLS_PROBE = "read_quote_total";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── global (non-quote) actions ───────────── */
function useGlobalMandyActions() {
  const go = useMandyGo();
  const navigate = go;
  const { user } = useAuth();

  const openQuote = (q: { id: string; quote_number?: string | null; customer_name?: string | null }): MandyResult => {
    const route = `/admin/estimates/${q.id}`;
    go(route);
    return { ok: true, message: `Opened ${q.quote_number || "the quote"}${q.customer_name ? ` for ${q.customer_name}` : ""}.`, data: { quote_id: q.id, route } };
  };

  /** Same default sort as the Quotes list: non-superseded, newest created first. */
  const openLatest = async (): Promise<MandyResult> => {
    const { data, error } = await latestQuoteQuery();
    if (error) return { ok: false, message: `Could not load quotes: ${error.message}` };
    if (!data?.length) return { ok: false, message: "No quotes found." };
    return openQuote(data[0]);
  };

  useRegisterMandyActions({
    open_last_quote: async () => openLatest(),
    open_latest_quote: async () => openLatest(),
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
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const onEndedRef = useRef<(() => void) | null>(null);
  const setOnReplyEnded = useCallback((fn: (() => void) | null) => { onEndedRef.current = fn; }, []);
  const [ttsCalls, setTtsCalls] = useState(0);
  const tokenRef = useRef(0); // per-utterance: cancel() bumps it so a cancelled reply never re-arms the mic
  const handleRef = useRef<SharedPlayback | null>(null);

  const cancel = useCallback(() => {
    tokenRef.current++;
    handleRef.current?.cancel();
    handleRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(async (text: string) => {
    cancel();
    const token = tokenRef.current;
    let fired = false;
    const end = () => { if (fired || tokenRef.current !== token) return; fired = true; onEndedRef.current?.(); };
    const t = formatForSpeech(text).trim();
    if (!t || muted) { end(); return; }
    const now = Date.now();
    if (lastRef.current && lastRef.current.text === t && now - lastRef.current.at < 4000) { end(); return; } // dedupe
    lastRef.current = { text: t, at: now };
    setTtsCalls((n) => n + 1);
    const { data, error } = await supabase.functions.invoke("mandy-agent", { body: { action: "tts", text: t, client_build: BUILD_ID } });
    if (tokenRef.current !== token) return;
    const d = data as { audio_base64?: string; mime?: string; spoken?: string } | null;
    if (!error && d?.audio_base64) {
      const h = playOnSharedAudio(`data:${d.mime || "audio/mpeg"};base64,${d.audio_base64}`, { startTimeoutMs: 2500 });
      handleRef.current = h;
      if (await h.started) { void h.ended.then(end); return; }
      if (tokenRef.current !== token) return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const said = d?.spoken || t;
      const u = new SpeechSynthesisUtterance(said);
      const voices = window.speechSynthesis.getVoices();
      u.rate = 1.1;
      u.voice = voices.find((v) => /en-ZA/i.test(v.lang)) || voices.find((v) => /en-GB/i.test(v.lang)) || null;
      armUtteranceEnd(u, said.length, end);
      window.speechSynthesis.speak(u);
    } else {
      end();
    }
  }, [cancel, muted]);

  return { speak, cancel, ttsCalls, setOnReplyEnded };
}

/* ───── greeting audio (Grok TTS, cached per page load, per user+text) ───── */
const greetingCache = new Map<string, Promise<ArrayBuffer>>();
const ttsReady = () => typeof window !== "undefined";
function prefetchGreeting(cacheKey: string, text: string): Promise<ArrayBuffer> {
  let bytes = greetingCache.get(cacheKey);
  if (!bytes) {
    const p = (async () => {
      const { data, error } = await supabase.functions.invoke("mandy-agent", { body: { action: "tts", text, client_build: BUILD_ID } });
      const b64 = (data as { audio_base64?: string } | null)?.audio_base64;
      if (error || !b64) throw new Error("no greeting audio");
      const bin = atob(b64); const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    })();
    bytes = p;
    greetingCache.set(cacheKey, p);
    p.catch(() => { if (greetingCache.get(cacheKey) === p) greetingCache.delete(cacheKey); }); // retry on next open
  }
  return bytes;
}
/** Soft ~120 ms 880 Hz ready beep. */
function playReadyBeep(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 880;
    g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.13);
  } catch { /* no beep */ }
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
  const [confirm, setConfirm] = useState<{ summary: string; lines?: string[]; danger?: boolean; run: () => Promise<MandyResult> } | null>(null);
  const confirmRef = useRef<typeof confirm>(null);
  confirmRef.current = confirm;
  const { speak, cancel, setOnReplyEnded } = useSpeaker(muted);

  const historyRef = useRef<Msg[]>([]);
  const busyRef = useRef(false);
  const recRef = useRef<WavRecorder | null>(null);
  const voiceModeRef = useRef(false);

  const audit = (tool: string, args: unknown, r: MandyResult) => {
    void supabase.functions.invoke("mandy-agent", { body: { action: "audit", client_build: BUILD_ID, tool, args, result: { message: r.message, data: r.data ?? null }, ok: r.ok } });
  };

  const execute = useCallback(async (name: string, args: Record<string, any>): Promise<MandyResult> => {
    const h = registry?.get(name);
    if (!h) {
      const mapped = mapLabourTool(name, args || {});
      if (mapped && registry?.get(mapped.action)) return execute(mapped.action, mapped.args);
      return { ok: false, message: unknownToolMessage(name, !!registry?.get(QUOTE_TOOLS_PROBE)) };
    }
    try {
      const r = await h(args || {});
      if (CONFIRM_REQUIRED.has(name) && !args?.__plan && r.ok && !r.confirm && !r.choices) {
        // Safety: destructive actions must come back as a confirm card.
        return { ok: false, message: `${name} needs an on-screen confirmation and was not run.` };
      }
      const route = (r.data as any)?.route;
      if (r.ok && !r.choices && !r.confirm && typeof route === "string" && r.verified === undefined) {
        await sleep(60);
        r.verified = routeReached(route, window.location.pathname, window.location.search);
      }
      audit(name, args, r);
      if (r.ok && !r.choices && !r.confirm) setAssistantContext(touchedPatch(r.data));
      if (/^(open_quote|open_last_quote|open_latest_quote|open_top_quote|create_quote_for_client)$/.test(name) && r.ok && !r.choices) {
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

  /** Multi-step plan → ONE Confirm card with a dry-run preview. Nothing runs until Confirm. */
  const preparePlan = useCallback(async (steps: PlanStep[], confidence: number): Promise<string> => {
    const g = gatePlan(steps, confidence, { quoteStatus: getMandyQuoteStatus() });
    if (g.kind === "block") return g.reason!;
    const summary = steps.map((s, i) => `${i + 1}. ${s.action.replace(/_/g, " ")}`).join(", ");
    if (g.kind === "chips") {
      setChoices([{ label: `Plan: ${summary}`, action: "__plan", args: { steps } }]);
      return "Not sure I got all of that — tap the plan to review it, or say it again.";
    }
    const pv = registry?.get("__preview_plan");
    if (!pv) return "Open the quote first, then say that again.";
    const r = await pv({ steps });
    const p = r.data?.preview as PlanPreview | undefined;
    if (!r.ok || !p) return r.message || "I couldn't work out that plan.";
    if (p.pick) {
      setChoices(p.pick.options.map((o) => ({
        label: o.label, action: "__plan",
        args: { steps: steps.map((s, i) => (i === p.pick!.step ? { ...s, args: { ...s.args, product_id: o.id } } : s)) },
      })));
      return `Which model? Tap one and I'll show the whole plan (${steps.length} steps) to confirm.`;
    }
    if (p.error) return `Step ${p.errorStep}: ${p.error} Nothing was changed.`;
    const money = (n: number) => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    setConfirm({
      summary: `Run ${steps.length} steps? Total ${money(p.before)} → ${money(p.after)} incl. VAT.`,
      lines: p.lines.map((l) => `${l.step}. ${l.label}${l.qty != null ? ` · ${l.qty}` : ""}${l.price != null ? ` · ${money(l.price)}` : ""}`),
      run: async () => {
        await registry?.get("__begin_undo")?.({});
        const rep = await runPlanSteps(steps, (s) => execute(s.action, { ...s.args, __plan: true }));
        if (rep.ran > 0) await registry?.get("__commit_undo")?.({ label: `the ${rep.ran}-step plan` });
        return { ok: rep.failedAt == null, message: planReportText(rep), data: { ran: rep.ran, total: rep.total } };
      },
    });
    return `Plan ready: ${steps.length} steps, total ${money(p.before)} to ${money(p.after)} incl. VAT. Tap Confirm to run it.`;
  }, [execute, registry]);

  const runTurn = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busyRef.current) return;
    busyRef.current = true;
    cancel();
    const hadPendingCard = !!confirmRef.current;
    setHeard(t);
    setChoices([]);
    setConfirm(null);
    setPhase("working");
    const msgs: Msg[] = [...historyRef.current.slice(-8)];
    let final = "";
    let lastUnverified = false;
    const results: MandyResult[] = [];
    const writes: boolean[] = [];
    let planTurn = false;
    const isWrite = (a?: string) => !!a && !/^(read_|show_|list_|open_|find_|search_|get_)/.test(a);
    try {
      // Deterministic multi-edit pre-parse: 2+ clauses → ONE local plan card, no model needed.
      const local = registry?.get("__preview_plan") ? parseMultiEdit(t) : null;
      if (local) {
        planTurn = true;
        const staleMsg = staleWriteRefusal("run_plan", useBuildStatus.getState().stale);
        final = staleMsg || await preparePlan(local, 1);
      }
      // Deterministic single labour command: straight to set_labour_hours, no model.
      // A bare "cancel / clear / start over" only cancels a pending card; otherwise quote intents route.
      const qi = !local ? parseQuoteIntent(t, { pendingCard: hadPendingCard }) : null;
      if (qi?.action === "cancel_pending") final = "Cancelled — nothing was changed.";
      const lab = !local && !qi ? parseLabourIntent(t) : null;
      if (lab) {
        if (!registry?.get(lab.action)) final = "Open the quote first, then say that again.";
        else {
          const staleMsg = staleWriteRefusal(lab.action, useBuildStatus.getState().stale);
          if (staleMsg) final = staleMsg;
          else {
            const r = await execute(lab.action, lab.args as Record<string, any>);
            if (r.choices?.length) setChoices(r.choices);
            if (r.confirm) setConfirm(r.confirm);
            results.push(r); writes.push(lab.action !== "read_labour");
            final = finalReplyFrom(results, "");
          }
        }
      }
      const inst = !local && !qi && !lab ? parseInstallCommand(t) : null;
      if (inst) {
        if (!registry?.get("edit_install")) final = "Open the quote first, then say that again.";
        else {
          const staleMsg = staleWriteRefusal("edit_install", useBuildStatus.getState().stale);
          if (staleMsg) final = staleMsg;
          else {
            const r = await execute("edit_install", inst as Record<string, any>);
            if (r.choices?.length) setChoices(r.choices);
            if (r.confirm) setConfirm(r.confirm);
            results.push(r); writes.push(true);
            final = finalReplyFrom(results, "");
          }
        }
      }
      const quick = !lab && !inst && qi && qi.action !== "cancel_pending" ? qi : null;
      if (quick) {
        if (!registry?.get(quick.action)) final = "Open the quote first, then say that again.";
        else {
          const staleMsg = staleWriteRefusal(quick.action, useBuildStatus.getState().stale);
          if (staleMsg) final = staleMsg;
          else {
            const r = await execute(quick.action, quick.args as Record<string, any>);
            if (r.choices?.length) setChoices(r.choices);
            if (r.confirm) setConfirm(r.confirm);
            results.push(r); writes.push(true);
            final = finalReplyFrom(results, "");
          }
        }
      }
      for (let step = 0; !local && !lab && !inst && !qi && step <= MAX_STEPS; step++) {
        const r0 = await routeVoiceCommand({
          transcript: step === 0 ? t : "",
          history: msgs,
          tools: toolsFor(registry?.names() || []),
          context: getAssistantContext() as Record<string, unknown>,
          forceText: step === MAX_STEPS,
        });
        if (step === 0) msgs.push({ role: "user", content: t });
        if (r0.stale) { useBuildStatus.getState().setLatest("server-newer"); final = r0.text || ""; break; }
        if (r0.error) { final = `Sorry, I couldn't reach my brain: ${r0.error}`; break; }
        if (r0.args && "__plan" in r0.args) delete (r0.args as any).__plan; // only the plan Confirm may set it
        const staleMsg = staleWriteRefusal(r0.plan ? "run_plan" : r0.action, useBuildStatus.getState().stale || (r0.action && !import.meta.env.DEV ? await checkForNewBuild() : false));
        if (staleMsg) { final = staleMsg; break; }
        if (r0.plan) {
          planTurn = true;
          const out = await preparePlan(r0.plan, r0.confidence);
          final = out;
          break;
        }
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
          results.push(r); writes.push(isWrite(r0.action));
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
        final = finalReplyFrom(results, r0.text || "");
        break;
      }
    } finally {
      busyRef.current = false;
    }
    if (!final && results.length) final = finalReplyFrom(results, "");
    if (!final) final = "I couldn't finish that — nothing more was done.";
    if (!planTurn) final = guardClaimedChange(final, results, writes);
    if (lastUnverified && !/confirm it on screen/i.test(final)) final = honestMessage({ ok: true, message: final, verified: false });
    final = formatReplyText(final);
    historyRef.current = [...historyRef.current, { role: "user", content: t }, { role: "assistant", content: final }].slice(-8);
    setReply(final);
    setPhase("idle");
    await speak(final); // the ONE utterance of this turn
  }, [cancel, execute, preparePlan, registry, speak]);

  const pickChoice = async (c: MandyChoice) => {
    setChoices([]);
    setPhase("working");
    if (c.action === "__plan") {
      const msg = formatReplyText(await preparePlan((c.args.steps as PlanStep[]) || [], 1));
      setReply(msg); setPhase("idle"); await speak(msg); return;
    }
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
    stopSharedAudio();
    try {
      const rec = new WavRecorder();
      // Reuse the mic + AudioContext unlocked in the tap (iOS keeps a fresh context suspended).
      const stream = await getMandyMicStream();
      const context = getMandyAudioContext() ?? undefined;
      await rec.start({ silenceMs: 1300, onSilence: () => void stopRef.current() }, { stream, context });
      if (!openRef.current) { rec.cancel(); return; }
      recRef.current = rec;
      voiceModeRef.current = true;
      setPhase("listening");
    } catch {
      setReply("Microphone unavailable — type instead.");
    }
  };

  /** Mic tap: greet once per session (Grok TTS on the shared primed <audio>), then listen. */
  const greetedRef = useRef(false);
  const greetingRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  /** Personalised greeting text + cache key (user id + text), resolved once per user. */
  const greetingRef2 = useRef<{ userId: string; text: string; key: string } | null>(null);
  const resolveGreeting = async (): Promise<{ text: string; key: string }> => {
    const uid = user?.id ?? "anon";
    if (greetingRef2.current?.userId === uid) return greetingRef2.current;
    let profile: { first_name?: string | null; full_name?: string | null } | null = null;
    if (user?.id) {
      const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      profile = data;
    }
    const text = greetingFor(profile, user?.user_metadata as Record<string, unknown> | null);
    const resolved = { userId: uid, text, key: `${uid}:${text}` };
    greetingRef2.current = resolved;
    return resolved;
  };
  const beginSession = async () => {
    unlockMandyVoiceFromTap(); // synchronous, inside the tap (idempotent)
    if (greetingRef.current || recRef.current || busyRef.current) return; // double-start guard
    greetingRef.current = true;
    const clearGreet = () => setPhase((p) => (p === "greeting" || p === "starting" ? "idle" : p));
    try {
      await greetThenListen({
        greeted: greetedRef,
        isCancelled: () => !openRef.current,
        beep: () => playReadyBeep(getMandyAudioContext()),
        startListening: () => startListening(),
        speak: async (onStarted, shouldPlay) => {
          if (muted) throw new Error("muted");
          setPhase("starting");
          const g = await resolveGreeting();
          const bytes = await prefetchGreeting(g.key, g.text);
          if (!openRef.current) throw new Error("closed");
          if (!shouldPlay()) { clearGreet(); return; } // abandoned: keep cache, don't play
          const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
          try {
            const h = playOnSharedAudio(url, { startTimeoutMs: 2500, maxMs: 12000 });
            const ok = await h.started;
            if (!ok) throw new Error("no playback");
            if (!shouldPlay()) { h.cancel(); clearGreet(); return; }
            setPhase("greeting"); // only once audio is REALLY playing
            onStarted();
            await h.ended;
          } finally {
            URL.revokeObjectURL(url);
          }
        },
      });
    } finally {
      greetingRef.current = false;
      clearGreet();
    }
  };

  // Hands-free: when a reply's audio finishes, re-arm the mic (no beep) while
  // the dock is open and the session is in voice mode.
  useEffect(() => {
    setOnReplyEnded(() => {
      if (openRef.current && voiceModeRef.current && !recRef.current && !busyRef.current) void startRef.current();
    });
    return () => setOnReplyEnded(null);
  }, [setOnReplyEnded]);

  useEffect(() => () => { recRef.current?.cancel(); cancel(); stopSharedAudio(); releaseMandyMic(); }, [cancel]);
  // "Ask Mandy" / ops-panel "Voice": open + greet once + listen.
  const listenRequest = useMandyDock((s) => s.listenRequest);
  const startRef = useRef(startListening);
  startRef.current = startListening;
  const beginRef = useRef(beginSession);
  beginRef.current = beginSession;
  useEffect(() => { if (listenRequest && open) void beginRef.current(); }, [listenRequest, open]);
  useEffect(() => {
    if (open) { if (ttsReady()) void resolveGreeting().then((g) => prefetchGreeting(g.key, g.text)).catch(() => {}); return; }
    recRef.current?.cancel(); recRef.current = null; cancel(); setPhase("idle");
    stopSharedAudio();
    releaseMandyMic();
    greetedRef.current = false; voiceModeRef.current = false;
  }, [open, cancel]);

  if (!user || !open) return null;

  const statusText = phase === "starting" ? "Starting…" : phase === "greeting" ? "Mandy is speaking…" : phase === "listening" ? "Listening… go ahead" : phase === "hearing" ? "Hearing…" : phase === "working" ? "Working…" : "Ready";

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
          <div className={confirm.danger ? "rounded-md border-2 border-destructive bg-destructive/15 p-2" : "rounded-md border border-destructive/40 bg-destructive/10 p-2"} data-testid={confirm.danger ? "mandy-danger-card" : undefined}>
            <p className={confirm.danger ? "text-xs font-semibold text-destructive" : "text-xs text-foreground"}>{confirm.summary}</p>
            {confirm.lines?.length ? (
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground" data-testid="mandy-plan-lines">
                {confirm.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={() => void runConfirm()}><Check className="h-3 w-3" /> Confirm</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => { setConfirm(null); setReply("Cancelled — nothing was changed."); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="relative inline-flex shrink-0">
          {phase === "listening" && <span className="absolute inset-0 rounded-md bg-destructive/40 animate-ping" aria-hidden />}
          <Button
            size="icon"
            variant={phase === "listening" ? "destructive" : "default"}
            className="relative h-9 w-9 shrink-0"
            disabled={phase === "hearing" || phase === "working" || phase === "greeting" || phase === "starting"}
            onClick={() => {
              if (phase === "listening") void stopListening();
              else void beginSession();
            }}
            aria-label={phase === "listening" ? "Stop" : "Talk"}
          >
            {phase === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        </span>
        <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = typed; setTyped(""); voiceModeRef.current = false; void runTurn(v); }}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead…" className="h-9 text-sm" disabled={phase === "working"} data-testid="mandy-input" />
          <Button type="submit" size="icon" variant="ghost" className="h-9 w-9" disabled={!typed.trim() || phase === "working"} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

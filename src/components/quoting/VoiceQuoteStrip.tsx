/**
 * VoiceQuoteStrip — quote-by-voice on the LIVE estimate (/admin/estimates/:id).
 *
 * Johan UX pivot: no turn-by-turn quiz. Speak (or paste) a whole scene —
 * several rooms allowed — see the transcript, get ONE editable breakdown card
 * grouped by area, tap Confirm once. Confirm writes through QuoteContext
 * (addArea / addItem) into the same quote_areas / quote_items the click editor
 * uses. Never a parallel voice draft.
 *
 * Kit SoT (voiceQuoteKit.ts): copper per metre, 10% waste on copper + its
 * Armaflex, insulation always auto-added, prices from the catalog only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Loader2, Undo2, Volume2, VolumeX, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { WavRecorder } from "@/lib/wavRecorder";
import { getUserCompanyId } from "@/lib/tenantUtils";
import { DEFAULT_LEAD_SOURCE } from "@/lib/leadSources";
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";
import VoiceBreakdownCard from "@/components/quoting/VoiceBreakdownCard";
import { clientDisplayName, isHighConfidence, rankClientHits } from "@/lib/voiceClientMatch";
import VoiceClientOverrideFields, { emptyClientDraft, type VoiceClientDraft } from "@/components/quoting/VoiceClientOverrideFields";
import {
  buildSceneBreakdown,
  isSaveable,
  parseUtterance,
  rand,
  sceneReadBack,
  sceneSubtotal,
  type SceneBreakdown,
  type ServiceRow,
} from "@/lib/voiceQuoteKit";

interface Props {
  vatRate: number;
  onChanged?: () => void;
}

type MicPhase = "idle" | "listening" | "transcribing";
type ClientPrompt =
  | { type: "customer_pick"; hits: CustomerSearchResult[]; query: string }
  | { type: "no_match"; query: string }
  | { type: "new_client_phone"; name: string; address?: string | null };

const customerLabel = clientDisplayName;

const EXAMPLE = "Main bedroom 18,000 BTU AR4500 Samsung. Outside wall so back-to-back, three metres of piping, quarter and half with lagging. Five metre drain pipe with three elbows. Labour about three hours. Lounge 12,000 BTU…";

export default function VoiceQuoteStrip({ vatRate, onChanged }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { meta, areas, items, addItem, addArea, updateQuote, deleteItem } = useQuoteContext();
  const { products } = useQuoteBuilderProducts();

  const { data: services = [] } = useQuery({
    queryKey: ["voice-quote-services"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hvac_services")
        .select("id, name, category, default_price, unit")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return (data || []) as ServiceRow[];
    },
  });

  // `?voice=1` (from the Quotes page voice start) opens the strip straight away.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("voice") === "1");
  const [micPhase, setMicPhase] = useState<MicPhase>("idle");
  const [speakReplies, setSpeakReplies] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("Tap the mic and describe the whole job — rooms, unit, piping, drain, labour — then confirm once.");
  const [breakdown, setBreakdown] = useState<SceneBreakdown | null>(null);
  const [clientPrompt, setClientPrompt] = useState<ClientPrompt | null>(null);
  const [saving, setSaving] = useState(false);

  const recorderRef = useRef<WavRecorder | null>(null);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const committedRef = useRef<string[][]>([]);
  const busyRef = useRef(false);

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  /* ────────────── speech out (optional, never re-arms the mic) ────────────── */
  const say = useCallback(
    (text: string) => {
      setReply(text);
      if (canSpeak && speakReplies) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/R (\d)/g, "rand $1"));
        const voices = window.speechSynthesis.getVoices();
        u.voice = voices.find((v) => /en-ZA/i.test(v.lang)) || voices.find((v) => /en-GB/i.test(v.lang)) || null;
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
      }
    },
    [canSpeak, speakReplies],
  );

  /* ────────────── scene → card ────────────── */
  const buildCard = useCallback(
    (text: string) => {
      const bd = buildSceneBreakdown(text, products, services, { fallbackAreaName: areas[0]?.name || "Items" });
      const n = bd.areas.flatMap((a) => a.lines).filter(isSaveable).length;
      const flagged = bd.areas.flatMap((a) => a.lines).filter((l) => !isSaveable(l)).length;
      setBreakdown(bd);
      if (!bd.areas.length || (!n && !flagged)) {
        say("Couldn't make any lines from that. Try: room, unit size, copper size and metres, drain, labour.");
        return;
      }
      say(
        `${n} line${n === 1 ? "" : "s"} across ${bd.areas.length} area${bd.areas.length === 1 ? "" : "s"}, ${rand(sceneSubtotal(bd))} excl. VAT.` +
          (flagged ? ` ${flagged} need${flagged === 1 ? "s" : ""} a tap on the card.` : " Check the card, then confirm."),
      );
    },
    [products, services, areas, say],
  );

  /* ────────────── one confirm → live quote ────────────── */
  const nextSortOrder = () => (items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0);

  const confirmScene = async () => {
    if (!breakdown) return;
    const groups = breakdown.areas.filter((a) => a.lines.some(isSaveable));
    if (!groups.length) { say("Nothing priced to save yet."); return; }
    setSaving(true);
    try {
      let sort = nextSortOrder();
      const ids: string[] = [];
      const created = new Map<string, string>(); // lower-cased name → area id (this run)
      for (const g of groups) {
        const name = g.name.trim() || "Items";
        const key = name.toLowerCase();
        let areaId = created.get(key) ?? areas.find((a) => a.name.trim().toLowerCase() === key)?.id ?? null;
        if (!areaId) {
          const row = await addArea(name);
          if (!row) throw new Error(`Could not create area “${name}”.`);
          areaId = row.id;
        }
        created.set(key, areaId);

        for (const l of g.lines) {
          if (!isSaveable(l)) continue;
          const perMetre = !!(l.product && l.product.sold_in_length && l.product.price_per_metre);
          const { line_note, ...restMeta } = l.meta as Record<string, unknown> & { line_note?: string | null };
          const row = await addItem({
            area_id: areaId,
            parent_item_id: null,
            product_id: l.product?.id ?? null,
            item_name: l.label,
            item_number: l.product?.product_code ?? null,
            description: l.product
              ? ((l.product as unknown as { ai_sales_description?: string | null }).ai_sales_description || l.product.description || null)
              : (l.service?.category ?? null),
            supplier: l.product?.supplier_name ?? null,
            quantity: l.quantity,
            length: null,
            unit_price: l.unitPrice,
            total_price: null,
            is_bundle: false,
            item_type: l.service ? "service" : "product",
            metadata: { unit_cost: l.unitCost, markup_percent: l.markupPct, spoken: l.spoken, area_notes: g.notes, ...restMeta },
            notes: typeof line_note === "string" && line_note ? line_note : null,
            source: l.service ? "service" : "catalog",
            sort_order: sort++,
            ...(perMetre ? { price_per_unit_label: "m", allows_decimal_qty: true, qty_step: 0.1 } : {}),
          });
          if (row) ids.push(row.id);
        }
      }
      if (ids.length) committedRef.current.push(ids);
      setBreakdown(null);
      setTranscript("");
      onChanged?.();
      const hasClient = !!meta?.customer_id;
      say(
        hasClient
          ? `Saved ${ids.length} line${ids.length === 1 ? "" : "s"} in ${groups.length} area${groups.length === 1 ? "" : "s"} for ${meta?.customer_name || "the client"}. Ready to send — use Send or PDF above, or describe the next room.`
          : `Saved ${ids.length} line${ids.length === 1 ? "" : "s"}. No client on this quote yet — set one before sending.`,
      );
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
      say("Saving failed part-way — check the quote below and confirm again for what's left.");
    } finally {
      setSaving(false);
    }
  };

  const undoLastConfirm = async () => {
    const ids = committedRef.current.pop();
    if (!ids?.length) { say("Nothing to undo."); return; }
    for (const id of ids) await deleteItem(id);
    onChanged?.();
    say(`Removed the last ${ids.length === 1 ? "line" : `${ids.length} lines`} from the quote.`);
  };

  /* ────────────── client find / create (kept from the start dialog contract) ────────────── */
  const setCustomer = async (c: CustomerSearchResult) => {
    const name = customerLabel(c);
    await updateQuote({ customer_id: c.id, customer_name: name });
    setClientPrompt(null);
    onChanged?.();
    say(`Client set to ${name}. Now describe the job.`);
  };

  const createCustomer = async (name: string, phone: string, address?: string | null) => {
    const [first, ...rest] = name.split(/\s+/);
    const company_id = await getUserCompanyId(user?.id);
    const { data, error } = await supabase
      .from("customers")
      .insert({
        first_name: first,
        last_name: rest.join(" ") || null,
        name,
        phone,
        status: "lead",
        lead_source: DEFAULT_LEAD_SOURCE,
        company_id,
        primary_address_line1: address || null,
        address: address || null,
      })
      .select("id")
      .single();
    if (error || !data) { say(`Could not create ${name}: ${error?.message || "unknown error"}.`); return; }
    await updateQuote({ customer_id: data.id, customer_name: name });
    setClientPrompt(null);
    onChanged?.();
    say(`New client ${name} added${address ? ` at ${address}` : ""} and set on this quote. Now describe the job.`);
  };

  /** Client commands are the only non-scene utterances. Returns true when handled. */
  const tryClientCommand = async (text: string): Promise<boolean> => {
    const intents = parseUtterance(text);
    const first = intents[0];
    if (!first) return false;
    if (clientPrompt?.type === "new_client_phone" && (first.kind === "phone" || (first.kind === "new_client" && first.phone))) {
      await createCustomer(clientPrompt.name, first.kind === "phone" ? first.phone : (first as { phone: string }).phone, clientPrompt.address);
      return true;
    }
    if (clientPrompt?.type === "customer_pick" && first.kind === "pick") {
      const c = clientPrompt.hits[first.index];
      if (c) { await setCustomer(c); return true; }
    }
    if (intents.length !== 1) return false;
    if (first.kind === "client" || first.kind === "phone") {
      const q = first.kind === "phone" ? first.phone : first.query;
      const { data, error } = await supabase.rpc("search_customers", { search_term: q, max_results: 10 });
      const raw = (error ? [] : (data || [])) as CustomerSearchResult[];
      const hits = rankClientHits(q, raw);
      if (!hits.length) {
        setClientPrompt({ type: "no_match", query: q });
        say(`No client matching “${q}”. Add them as a new client, or say the name again.`);
        return true;
      }
      if (hits.length === 1 && isHighConfidence(q, hits[0])) { await setCustomer(hits[0]); return true; }
      setClientPrompt({ type: "customer_pick", hits, query: q });
      say(`Heard “${q}” — tap the right client, or add them as new.`);
      return true;
    }
    if (first.kind === "new_client") {
      if (!first.name) { say("What is the client's name?"); return true; }
      if (!first.phone) { setClientPrompt({ type: "new_client_phone", name: first.name, address: first.address ?? null }); say(`Phone number for ${first.name}? Type or say it.`); return true; }
      await createCustomer(first.name, first.phone, first.address);
      return true;
    }
    return false;
  };

  const handleUtterance = useCallback(
    async (text: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        if (await tryClientCommand(text)) return;
        setTranscript(text);
        buildCard(text);
      } finally {
        busyRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildCard, clientPrompt],
  );
  const handleUtteranceRef = useRef(handleUtterance);
  handleUtteranceRef.current = handleUtterance;

  /* ────────────── mic (long-form: generous pause before auto-stop) ────────────── */
  const startRecording = useCallback(async () => {
    if (recorderRef.current || busyRef.current) return;
    try {
      if (canSpeak) window.speechSynthesis.cancel();
      const rec = new WavRecorder();
      // No VAD / silence auto-stop: recording runs until the user taps Stop.
      await rec.start();
      recorderRef.current = rec;
      setMicPhase("listening");
      setReply("Listening — describe the whole job. Tap Stop when done.");
    } catch {
      setMicPhase("idle");
      toast({ title: "Microphone unavailable", description: "Allow microphone access, or paste the scene below.", variant: "destructive" });
    }
  }, [canSpeak, toast]);

  const stopRecording = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setMicPhase("transcribing");
    try {
      const { base64, bytes } = await rec.stop();
      if (bytes < 2048) throw new Error("That was empty — try again.");
      const { data, error } = await supabase.functions.invoke("voice-quote-parse", { body: { action: "transcribe", audio: base64 } });
      if (error || (data as { error?: string })?.error) throw new Error((data as { error?: string })?.error || error?.message || "Transcription failed.");
      const text = String((data as { transcript?: string }).transcript ?? "").trim();
      setMicPhase("idle");
      if (!text) { say("Nothing was picked up."); return; }
      await handleUtteranceRef.current(text);
    } catch (e) {
      setMicPhase("idle");
      toast({ title: "Voice capture failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    }
  };
  stopRef.current = stopRecording;

  const toggleMic = () => {
    if (!open) setOpen(true);
    if (micPhase === "listening") { void stopRecording(); return; }
    if (micPhase === "idle") void startRecording();
  };

  const stopAll = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    if (canSpeak) window.speechSynthesis.cancel();
    setMicPhase("idle");
  };

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingCount = useMemo(() => (breakdown ? breakdown.areas.flatMap((a) => a.lines).filter(isSaveable).length : 0), [breakdown]);

  return (
    <section className="print:hidden rounded-lg border border-border bg-card">
      {/* header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant={micPhase === "listening" ? "destructive" : "default"}
          onClick={toggleMic}
          disabled={micPhase === "transcribing" || saving}
          className="gap-2"
          aria-label={micPhase === "listening" ? "Stop listening" : "Start voice quote"}
        >
          {micPhase === "transcribing" ? <Loader2 className="h-4 w-4 animate-spin" /> : micPhase === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {micPhase === "listening" ? "Stop" : micPhase === "transcribing" ? "Hearing…" : "Voice quote"}
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={reply}>{reply}</p>
        {breakdown && pendingCount > 0 && <Badge variant="secondary">{pendingCount} pending · {rand(sceneSubtotal(breakdown))}</Badge>}
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSpeakReplies((v) => !v)} title={speakReplies ? "Mute spoken replies" : "Speak replies"} disabled={!canSpeak}>
          {speakReplies && canSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen((v) => !v); if (open) stopAll(); }}>
          {open ? "Hide" : "Open"}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {!meta?.customer_id && (
            <p className="text-xs text-amber-700 dark:text-amber-400">No client on this quote yet — type “client Andre Blom” or “new client Jane Doe 082 123 4567” below.</p>
          )}

          {clientPrompt?.type === "customer_pick" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Heard: “{clientPrompt.query}”</p>
              <div className="flex flex-wrap gap-2">
                {clientPrompt.hits.map((c, i) => (
                  <Button key={c.id} type="button" size="sm" variant="outline" onClick={() => void setCustomer(c)}>
                    {i + 1}. {customerLabel(c)} · {c.phone}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const name = clientPrompt.query;
                    setClientPrompt({ type: "new_client_phone", name, address: null });
                    say(`Phone number for ${name}? Type or say it.`);
                  }}
                >
                  Add as new client “{clientPrompt.query}”
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setClientPrompt({ type: "no_match", query: clientPrompt.query })}>None of these</Button>
              </div>
            </div>
          )}

          {clientPrompt?.type === "no_match" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Heard: “{clientPrompt.query}” — no client picked.</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const name = clientPrompt.query;
                  setClientPrompt({ type: "new_client_phone", name, address: null });
                  say(`Phone number for ${name}? Type or say it.`);
                }}
              >
                Add as new client “{clientPrompt.query}”
              </Button>
            </div>
          )}

          {/* transcript / paste box — the single input for a scene */}
          <form
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); if (transcript.trim()) void handleUtteranceRef.current(transcript.trim()); }}
          >
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={EXAMPLE}
              rows={3}
              className="text-sm"
              disabled={saving || micPhase !== "idle"}
              aria-label="Transcript"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" variant="outline" className="gap-1" disabled={!transcript.trim() || saving || micPhase !== "idle"}>
                <Sparkles className="h-4 w-4" /> {breakdown ? "Re-build breakdown" : "Build breakdown"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => breakdown && say(sceneReadBack(breakdown, vatRate))} disabled={!breakdown}>
                Read back
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void undoLastConfirm()} disabled={saving || !committedRef.current.length} className="ml-auto">
                <Undo2 className="mr-1 h-4 w-4" /> Undo last save
              </Button>
            </div>
          </form>

          {breakdown && (
            <VoiceBreakdownCard
              breakdown={breakdown}
              products={products}
              vatRate={vatRate}
              saving={saving}
              hasClient={!!meta?.customer_id}
              onChange={setBreakdown}
              onConfirm={() => void confirmScene()}
              onDiscard={() => { setBreakdown(null); say("Discarded — nothing was saved."); }}
            />
          )}
        </div>
      )}
    </section>
  );
}

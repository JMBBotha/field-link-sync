/**
 * VoiceQuoteStrip — quote-by-voice on the LIVE estimate (/admin/estimates/:id).
 *
 * Lives inside <QuoteProvider>; every save goes through QuoteContext.addItem /
 * addArea / updateQuote, so voice mutates the same rows the click editor does.
 * No parallel voice draft. Short turns: one question or one confirmation.
 *
 * Kit SoT (voiceQuoteKit.ts): copper per metre, 10% waste on copper + its
 * Armaflex, insulation always auto-added, prices from the catalog only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Loader2, Check, X, Undo2, Volume2, VolumeX, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { WavRecorder } from "@/lib/wavRecorder";
import { getUserCompanyId } from "@/lib/tenantUtils";
import { DEFAULT_LEAD_SOURCE } from "@/lib/leadSources";
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import {
  COPPER_KIT,
  buildCopperKit,
  decide,
  lineTotal,
  parseUtterance,
  pendingSubtotal,
  productLine,
  rand,
  rankProducts,
  rankServices,
  readBackText,
  serviceLine,
  type PendingLine,
  type PipeSize,
  type RankedHit,
  type ServiceRow,
  type VoiceIntent,
} from "@/lib/voiceQuoteKit";

interface Props {
  vatRate: number;
  onChanged?: () => void;
}

type Question =
  | { type: "product_pick"; hits: RankedHit<PaletteProduct>[]; quantity: number; label: string }
  | { type: "service_pick"; hits: RankedHit<ServiceRow>[]; quantity: number }
  | { type: "customer_pick"; hits: CustomerSearchResult[] }
  | { type: "copper_size"; runM: number | null }
  | { type: "copper_metres"; sizes: PipeSize[] }
  | { type: "new_client_phone"; name: string };

type MicPhase = "idle" | "listening" | "transcribing";

const customerLabel = (c: CustomerSearchResult) =>
  [c.company_name, [c.first_name, c.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" — ") || c.phone;

export default function VoiceQuoteStrip({ vatRate, onChanged }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { meta, areas, items, addItem, addArea, updateQuote, deleteItem, ensureDefaultArea } = useQuoteContext();
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

  const [open, setOpen] = useState(false);
  const [micPhase, setMicPhase] = useState<MicPhase>("idle");
  const [handsFree, setHandsFree] = useState(true);
  const [speakReplies, setSpeakReplies] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("Tap the mic and say e.g. “5 metres quarter copper”, “labour 12 kW”, “client Andre Blom”.");
  const [question, setQuestion] = useState<Question | null>(null);
  const [pending, setPending] = useState<PendingLine[]>([]);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [targetAreaId, setTargetAreaId] = useState<string | null>(null);

  const recorderRef = useRef<WavRecorder | null>(null);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const queueRef = useRef<VoiceIntent[]>([]);
  const committedRef = useRef<string[][]>([]);
  const busyRef = useRef(false);
  const listenAfterSpeakRef = useRef(false);

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  /* ────────────── speech out ────────────── */
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});
  const say = useCallback(
    (text: string, thenListen = true) => {
      setReply(text);
      listenAfterSpeakRef.current = thenListen && handsFree;
      if (canSpeak && speakReplies) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/R (\d)/g, "rand $1"));
        const voices = window.speechSynthesis.getVoices();
        u.voice = voices.find((v) => /en-ZA/i.test(v.lang)) || voices.find((v) => /en-GB/i.test(v.lang)) || null;
        u.rate = 1.05;
        u.onend = () => {
          if (listenAfterSpeakRef.current && open) void startRecordingRef.current();
        };
        window.speechSynthesis.speak(u);
      } else if (listenAfterSpeakRef.current && open) {
        void startRecordingRef.current();
      }
    },
    [canSpeak, speakReplies, handsFree, open],
  );

  /* ────────────── quote writes ────────────── */
  const nextSortOrder = () => (items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0);

  const resolveArea = async () => {
    if (targetAreaId && areas.some((a) => a.id === targetAreaId)) return targetAreaId;
    const area = areas[0] || (await ensureDefaultArea()) || (await addArea("Items"));
    return area?.id ?? null;
  };

  const commit = async () => {
    if (!pending.length) {
      say("Nothing on the list to save yet.");
      return;
    }
    setSaving(true);
    try {
      const areaId = await resolveArea();
      let sort = nextSortOrder();
      const ids: string[] = [];
      for (const l of pending) {
        const perMetre = !!(l.product && l.product.sold_in_length && l.product.price_per_metre);
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
          metadata: { unit_cost: l.unitCost, markup_percent: l.markupPct, ...l.meta },
          notes: null,
          source: l.service ? "service" : "catalog",
          sort_order: sort++,
          ...(perMetre ? { price_per_unit_label: "m", allows_decimal_qty: true, qty_step: 0.1 } : {}),
        });
        if (row) ids.push(row.id);
      }
      if (ids.length) committedRef.current.push(ids);
      const n = pending.length;
      setPending([]);
      setQuestion(null);
      onChanged?.();
      say(`Saved ${n} line${n === 1 ? "" : "s"} to the quote. Anything else?`);
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
      say("Saving failed — nothing was written. Try confirm again.", false);
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (pending.length) {
      const last = pending[pending.length - 1];
      const group = last.meta.group;
      const keep = group ? pending.filter((l) => l.meta.group !== group) : pending.slice(0, -1);
      setPending(keep);
      say(`Removed ${last.label} from the list.`);
      return;
    }
    const ids = committedRef.current.pop();
    if (!ids?.length) {
      say("Nothing to undo.");
      return;
    }
    for (const id of ids) await deleteItem(id);
    onChanged?.();
    say(`Removed the last ${ids.length === 1 ? "line" : `${ids.length} lines`} from the quote.`);
  };

  /* ────────────── resolvers ────────────── */
  const pushLines = (lines: PendingLine[]) => setPending((p) => [...p, ...lines]);

  const addCopper = (sizes: PipeSize[], runM: number) => {
    const added: string[] = [];
    const missing: string[] = [];
    const group = `${Date.now()}`;
    const lines: PendingLine[] = [];
    for (const sz of sizes) {
      const kit = buildCopperKit(sz, runM, products);
      kit.lines.forEach((l) => { l.meta.group = group; lines.push(l); });
      missing.push(...kit.missing);
      if (kit.lines.length) added.push(`${kit.lines[0].quantity} metres ${COPPER_KIT[sz].spoken} copper with Armaflex`);
    }
    pushLines(lines);
    let msg = added.length ? `Added ${added.join(" and ")} — ${runM} metres plus 10% waste.` : "";
    if (missing.length) msg += ` ${missing.join(", ")} not in the live catalog, skipped.`;
    say(`${msg} Anything else?`.trim());
  };

  const addProductPick = (p: PaletteProduct, quantity: number) => {
    const line = productLine(p, quantity);
    pushLines([line]);
    say(`Added ${line.quantity} ${line.unitLabel} ${line.label} at ${rand(line.unitPrice)}. Anything else?`);
  };

  const addServicePick = (s: ServiceRow, quantity: number) => {
    const line = serviceLine(s, quantity);
    pushLines([line]);
    say(`Added ${line.label} at ${rand(line.unitPrice)}. Anything else?`);
  };

  const askOptions = <T,>(hits: RankedHit<T>[], label: (t: T) => string, prompt: string) => {
    const opts = hits.map((h, i) => `${i + 1}. ${label(h.item)}`).join(", ");
    say(`${prompt} ${opts}. Which one?`);
  };

  const setCustomer = async (c: CustomerSearchResult) => {
    const name = customerLabel(c);
    await updateQuote({ customer_id: c.id, customer_name: name });
    onChanged?.();
    say(`Client set to ${name}. What are we quoting?`);
  };

  const createCustomer = async (name: string, phone: string) => {
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
      })
      .select("id")
      .single();
    if (error || !data) {
      say(`Could not create ${name}: ${error?.message || "unknown error"}.`, false);
      return;
    }
    await updateQuote({ customer_id: data.id, customer_name: name });
    onChanged?.();
    say(`New client ${name} added and set on this quote. What are we quoting?`);
  };

  /* ────────────── intent handling ────────────── */
  const handleIntent = async (it: VoiceIntent): Promise<boolean /* keep draining queue */> => {
    switch (it.kind) {
      case "confirm":
        await commit();
        return false;
      case "cancel":
        setPending([]);
        setQuestion(null);
        queueRef.current = [];
        say("Cleared the list. Nothing was saved.");
        return false;
      case "undo":
        await undo();
        return false;
      case "readback":
        say(readBackText(pending, vatRate));
        return false;
      case "help":
        say("Say a client name, an area, copper like 5 metres quarter copper, labour like install 12 kilowatt, or a product. Say done to read back, confirm to save.");
        return false;
      case "skip":
        say("Skipped.");
        return true;
      case "pick":
        say("Nothing to pick from right now.");
        return true;
      case "phone":
        say("Say new client, then the name and number.");
        return true;
      case "area": {
        const area = await addArea(it.name);
        if (area) {
          setTargetAreaId(area.id);
          onChanged?.();
          say(`Area ${it.name} added. Next lines go there.`);
        } else say("Could not add that area.");
        return true;
      }
      case "client": {
        const { data, error } = await supabase.rpc("search_customers", { search_term: it.query, max_results: 5 });
        const hits = (error ? [] : (data || [])) as CustomerSearchResult[];
        if (!hits.length) {
          say(`No client matching ${it.query}. Say new client ${it.query} with a phone number to add them.`);
          return false;
        }
        if (hits.length === 1) {
          await setCustomer(hits[0]);
          return true;
        }
        setQuestion({ type: "customer_pick", hits: hits.slice(0, 3) });
        say(`Found ${hits.slice(0, 3).map((c, i) => `${i + 1}. ${customerLabel(c)} ${c.phone}`).join(", ")}. Which one?`);
        return false;
      }
      case "new_client": {
        if (!it.name) { say("What is the client's name?"); return false; }
        if (!it.phone) {
          setQuestion({ type: "new_client_phone", name: it.name });
          say(`Phone number for ${it.name}?`);
          return false;
        }
        await createCustomer(it.name, it.phone);
        return true;
      }
      case "copper": {
        if (!it.sizes.length) {
          setQuestion({ type: "copper_size", runM: it.runM });
          say("Which size — quarter, three-eighths, half, five-eighths or three-quarter?");
          return false;
        }
        if (it.runM == null) {
          setQuestion({ type: "copper_metres", sizes: it.sizes });
          say(`How many metres of ${it.sizes.map((s) => COPPER_KIT[s].spoken).join(" and ")}?`);
          return false;
        }
        addCopper(it.sizes, it.runM);
        return true;
      }
      case "labour": {
        const hits = rankServices(it.query, services);
        const d = decide(hits);
        if (d.pick) { addServicePick(d.pick, it.quantity); return true; }
        if (!d.ask.length) { say(`No labour service matching ${it.query || "that"} in Services.`); return true; }
        setQuestion({ type: "service_pick", hits: d.ask, quantity: it.quantity });
        askOptions(d.ask, (s) => `${s.name} ${rand(Number(s.default_price || 0))}`, "Labour options:");
        return false;
      }
      case "chase": {
        const sHits = rankServices("chase", services);
        const pHits = rankProducts("chase", products);
        if (sHits.length) { addServicePick(sHits[0].item, it.quantity); return true; }
        if (pHits.length) { addProductPick(pHits[0].item, it.quantity); return true; }
        say("No chasing item in the live catalog or Services — add it there first. Skipped.");
        return true;
      }
      case "cable":
      case "product": {
        const query = it.kind === "cable" ? (it.query || "cable") : it.query;
        const hits = rankProducts(query, products);
        const d = decide(hits);
        if (d.pick) { addProductPick(d.pick, it.quantity); return true; }
        if (!d.ask.length) {
          say(`Nothing in the live catalog for ${query}. Skipped — add it with the add bar.`);
          return true;
        }
        setQuestion({ type: "product_pick", hits: d.ask, quantity: it.quantity, label: query });
        askOptions(d.ask, (p) => `${p.short_name || p.product_code} ${rand(productLine(p, 1).unitPrice)}`, `For ${query}:`);
        return false;
      }
      case "unknown":
        say(`Didn't catch “${it.text}”. Try a product, copper size and metres, or labour.`);
        return true;
    }
  };

  /** Try to consume an utterance as the answer to the open question. */
  const answerQuestion = async (q: Question, intents: VoiceIntent[], rawText: string): Promise<boolean> => {
    const first = intents[0];
    if (!first) return false;
    if (first.kind === "cancel" || first.kind === "skip") {
      setQuestion(null);
      say(first.kind === "skip" ? "Skipped. Anything else?" : "Okay, dropped that.");
      return true;
    }
    switch (q.type) {
      case "product_pick":
      case "service_pick":
      case "customer_pick": {
        let idx = first.kind === "pick" ? first.index : -1;
        if (idx < 0) {
          // spoken name of an option
          const t = rawText.toLowerCase();
          const labels = q.type === "customer_pick" ? q.hits.map(customerLabel) : q.hits.map((h) => (q.type === "product_pick" ? (h.item as PaletteProduct).short_name || (h.item as PaletteProduct).product_code : (h.item as ServiceRow).name));
          idx = labels.findIndex((l) => l && t.includes(l.toLowerCase().slice(0, 12)));
        }
        if (idx < 0 || idx >= q.hits.length) return false;
        setQuestion(null);
        if (q.type === "product_pick") addProductPick(q.hits[idx].item, q.quantity);
        else if (q.type === "service_pick") addServicePick(q.hits[idx].item, q.quantity);
        else await setCustomer(q.hits[idx]);
        return true;
      }
      case "copper_size": {
        const cop = intents.find((i) => i.kind === "copper");
        if (cop && cop.kind === "copper" && cop.sizes.length) {
          setQuestion(null);
          const runM = cop.runM ?? q.runM;
          if (runM == null) { setQuestion({ type: "copper_metres", sizes: cop.sizes }); say("How many metres?"); return true; }
          addCopper(cop.sizes, runM);
          return true;
        }
        return false;
      }
      case "copper_metres": {
        const cop = intents.find((i) => i.kind === "copper");
        const n = cop?.kind === "copper" ? cop.runM : Number(rawText.replace(/[^\d.]/g, ""));
        if (n != null && Number.isFinite(n) && n > 0) {
          setQuestion(null);
          addCopper(cop?.kind === "copper" && cop.sizes.length ? cop.sizes : q.sizes, n);
          return true;
        }
        return false;
      }
      case "new_client_phone": {
        const ph = first.kind === "phone" ? first.phone : first.kind === "new_client" ? first.phone : null;
        if (!ph) return false;
        setQuestion(null);
        await createCustomer(q.name, ph);
        return true;
      }
    }
  };

  const handleUtterance = useCallback(
    async (text: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setHeard(text);
      try {
        const intents = parseUtterance(text);
        if (!intents.length) { say("Didn't catch that."); return; }
        if (question) {
          const consumed = await answerQuestion(question, intents, text);
          if (consumed) return;
          setQuestion(null); // moved on — drop the open question
        }
        queueRef.current = intents;
        while (queueRef.current.length) {
          const it = queueRef.current.shift()!;
          const cont = await handleIntent(it);
          if (!cont) break;
        }
      } finally {
        busyRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question, pending, products, services, areas, items, targetAreaId, say, vatRate],
  );
  const handleUtteranceRef = useRef(handleUtterance);
  handleUtteranceRef.current = handleUtterance;

  /* ────────────── mic ────────────── */
  const startRecording = useCallback(async () => {
    if (recorderRef.current || busyRef.current) return;
    try {
      if (canSpeak) window.speechSynthesis.cancel();
      const rec = new WavRecorder();
      let spoke = false;
      await rec.start({
        onSpeechStart: () => { spoke = true; },
        onSilence: () => {
          if (spoke) void stopRef.current?.();
          else { rec.cancel(); recorderRef.current = null; setMicPhase("idle"); }
        },
      });
      recorderRef.current = rec;
      setMicPhase("listening");
    } catch {
      setMicPhase("idle");
      toast({ title: "Microphone unavailable", description: "Allow microphone access, or type a command below.", variant: "destructive" });
    }
  }, [canSpeak, toast]);
  startRecordingRef.current = startRecording;

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
    listenAfterSpeakRef.current = false;
    if (canSpeak) window.speechSynthesis.cancel();
    setMicPhase("idle");
  };

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = useMemo(() => pendingSubtotal(pending), [pending]);
  const optionLabels: string[] = useMemo(() => {
    if (!question) return [];
    if (question.type === "product_pick") return question.hits.map((h) => `${h.item.short_name || h.item.product_code} · ${rand(productLine(h.item, 1).unitPrice)}`);
    if (question.type === "service_pick") return question.hits.map((h) => `${h.item.name} · ${rand(Number(h.item.default_price || 0))}`);
    if (question.type === "customer_pick") return question.hits.map((c) => `${customerLabel(c)} · ${c.phone}`);
    return [];
  }, [question]);

  const submitTyped = async () => {
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    if (!open) setOpen(true);
    await handleUtteranceRef.current(t);
  };

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
          {micPhase === "listening" ? "Listening…" : micPhase === "transcribing" ? "Hearing…" : "Voice quote"}
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={reply}>{reply}</p>
        {pending.length > 0 && <Badge variant="secondary">{pending.length} pending · {rand(subtotal)}</Badge>}
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSpeakReplies((v) => !v)} title={speakReplies ? "Mute spoken replies" : "Speak replies"} disabled={!canSpeak}>
          {speakReplies && canSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen((v) => !v); if (open) stopAll(); }}>
          {open ? "Hide" : "Open"}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {heard && <p className="text-xs text-muted-foreground">Heard: “{heard}”</p>}
          {!meta?.customer_id && (
            <p className="text-xs text-amber-700 dark:text-amber-400">No client on this quote yet — say “client Andre Blom” or “new client Jane Doe 082 123 4567”.</p>
          )}

          {optionLabels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {optionLabels.map((l, i) => (
                <Button key={i} type="button" size="sm" variant="outline" onClick={() => void handleUtteranceRef.current(String(i + 1))}>
                  {i + 1}. {l}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => void handleUtteranceRef.current("skip")}>Skip</Button>
            </div>
          )}

          {pending.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {pending.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="tabular-nums">{l.quantity} {l.unitLabel}</span> · {l.label}
                    {l.product?.product_code && <span className="ml-1 text-xs text-muted-foreground">{l.product.product_code}</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{rand(l.unitPrice)}</span>
                  <span className="w-24 text-right tabular-nums">{rand(lineTotal(l))}</span>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`Remove ${l.label}`} onClick={() => setPending((p) => p.filter((x) => x.id !== l.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
              <li className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                <span>Subtotal excl. VAT · incl. {rand(Math.round(subtotal * (1 + vatRate) * 100) / 100)}</span>
                <span className="font-medium text-foreground tabular-nums">{rand(subtotal)}</span>
              </li>
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); void submitTyped(); }}
            >
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="or type: 5 metres quarter copper"
                className="h-9"
                disabled={saving}
              />
              <Button type="submit" size="icon" variant="outline" className="h-9 w-9" aria-label="Send command" disabled={!typed.trim() || saving}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleUtteranceRef.current("read back")} disabled={!pending.length}>
              Read back
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void undo()} disabled={saving}>
              <Undo2 className="mr-1 h-4 w-4" /> Undo
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void handleUtteranceRef.current("cancel")} disabled={!pending.length || saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void commit()} disabled={!pending.length || saving} className="gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm &amp; save
            </Button>
            <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} /> hands-free
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

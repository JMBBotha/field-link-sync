/**
 * VoiceQuoteStrip — Mandy quote mode on the live quote (estimate page and
 * quote builder). The mic opens Mandy in quote mode; she sends what was said
 * to Grok (mandy-quote-plan) for a structured plan, every item is matched with
 * the ONE shared catalog matcher, and the existing breakdown card is the
 * confirm step. Confirm writes through addCatalogProductToQuote (standard
 * install for AC units). Replies are spoken by Mandy (Grok voice eve).
 * Each turn is logged to mandy_voice_logs.
 */
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, Loader2, Undo2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { useInstallTemplates } from "@/hooks/useInstallTemplates";
import { getUserCompanyId } from "@/lib/tenantUtils";
import { DEFAULT_LEAD_SOURCE } from "@/lib/leadSources";
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";
import VoiceBreakdownCard from "@/components/quoting/VoiceBreakdownCard";
import { clientDisplayName, isHighConfidence, rankClientHits } from "@/lib/voiceClientMatch";
import VoiceClientOverrideFields, { emptyClientDraft, type VoiceClientDraft } from "@/components/quoting/VoiceClientOverrideFields";
import { isSaveable, rand, sceneReadBack, sceneSubtotal, type SceneBreakdown, type ServiceRow } from "@/lib/voiceQuoteKit";
import { openMandyQuoteMode, useMandyDock, useRegisterMandyActions } from "@/lib/mandy/registry";
import { planMatches, resolvePlan, sanitizePlan, writeBreakdown } from "@/lib/mandy/quotePlan";

interface Props {
  vatRate: number;
  onChanged?: () => void;
}

type ClientPrompt = { type: "customer_pick"; hits: CustomerSearchResult[]; query: string } | { type: "no_match"; query: string };

const EXAMPLE = "Main bedroom 18K Samsung AR40 with 5 m piping and 2 trunking lengths. Lounge 12K Samsung AR40…";

async function logTurn(id: string, patch: Record<string, unknown>, insert = false) {
  try {
    if (insert) await supabase.from("mandy_voice_logs" as any).insert({ id, ...patch } as any);
    else await supabase.from("mandy_voice_logs" as any).update(patch as any).eq("id", id);
  } catch { /* logging never blocks the quote */ }
}

export default function VoiceQuoteStrip({ vatRate, onChanged }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { quoteId, meta, areas, items, addItem, addArea, updateQuote, deleteItem } = useQuoteContext();
  const { products } = useQuoteBuilderProducts();
  const { bundles } = useQuoteBuilderBundles();
  const { templates } = useInstallTemplates();
  const say = useMandyDock((s) => s.say);

  const { data: services = [] } = useQuery({
    queryKey: ["voice-quote-services"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("hvac_services").select("id, name, category, default_price, unit").eq("is_active", true).order("category");
      if (error) throw error;
      return (data || []) as ServiceRow[];
    },
  });

  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("voice") === "1");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("Tap Ask Mandy and describe the job — rooms, units, piping, extras — then confirm once.");
  const [breakdown, setBreakdown] = useState<SceneBreakdown | null>(null);
  const [clientPrompt, setClientPrompt] = useState<ClientPrompt | null>(null);
  const [clientDraft, setClientDraft] = useState<VoiceClientDraft>(emptyClientDraft());
  const [planning, setPlanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const committedRef = useRef<string[][]>([]);
  const logIdRef = useRef<string | null>(null);

  const speak = useCallback((text: string) => { setReply(text); say(text); }, [say]);

  /* ───── client (Mandy find_client rule: one strong match sets it, else chips) ───── */
  const setCustomer = async (c: CustomerSearchResult) => {
    const name = clientDisplayName(c);
    await updateQuote({ customer_id: c.id, customer_name: name });
    setClientPrompt(null);
    onChanged?.();
    speak(`Client set to ${name}.`);
  };
  const lookupClient = async (q: string, auto = true): Promise<string> => {
    const { data, error } = await supabase.rpc("search_customers", { search_term: q, max_results: 10 });
    const hits = rankClientHits(q, (error ? [] : data || []) as CustomerSearchResult[]);
    setClientDraft({ ...emptyClientDraft(q) });
    if (!hits.length) { setClientPrompt({ type: "no_match", query: q }); return `No client matching ${q} — add them below.`; }
    if (auto && hits.length === 1 && isHighConfidence(q, hits[0])) {
      const name = clientDisplayName(hits[0]);
      await updateQuote({ customer_id: hits[0].id, customer_name: name });
      setClientPrompt(null);
      onChanged?.();
      return `Client set to ${name}.`;
    }
    setClientPrompt({ type: "customer_pick", hits, query: q });
    return `Tap the right client for ${q}.`;
  };
  const saveOverrideAsNew = async () => {
    const d = clientDraft;
    if (!d.name.trim() || !d.phone.trim()) { speak("Name and phone are needed to save a new client."); return; }
    const name = d.name.trim();
    const [first, ...rest] = name.split(/\s+/);
    const company_id = await getUserCompanyId(user?.id);
    const { data, error } = await supabase.from("customers").insert({
      first_name: first, last_name: rest.join(" ") || null, name, phone: d.phone.trim(), status: "lead",
      lead_source: DEFAULT_LEAD_SOURCE, company_id, primary_address_line1: d.address.trim() || null, address: d.address.trim() || null,
      ...(d.email.trim() ? { email: d.email.trim() } : {}),
    }).select("id").single();
    if (error || !data) { speak(`Could not create ${name}: ${error?.message || "unknown error"}.`); return; }
    await updateQuote({ customer_id: data.id, customer_name: name });
    setClientPrompt(null);
    onChanged?.();
    speak(`New client ${name} added and set on this quote.`);
  };

  /* ───── one scene: Grok plan → shared matcher → breakdown card ───── */
  const runScene = useCallback(async (text: string): Promise<string> => {
    const t = text.trim();
    if (!t) return "I didn't catch anything.";
    if (!products.length) return "The catalog is still loading — try again in a moment.";
    setOpen(true);
    setPlanning(true);
    setTranscript(t);
    try {
      const { data, error } = await supabase.functions.invoke("mandy-quote-plan", { body: { transcript: t, areas: areas.map((a) => a.name) } });
      const errMsg = (data as { error?: string } | null)?.error || error?.message;
      if (errMsg) return `Sorry, I couldn't plan that: ${errMsg}`;
      const plan = sanitizePlan((data as { plan?: unknown }).plan);
      const bd = resolvePlan(plan, { products, bundles: bundles as any, templates, services, fallbackArea: areas[0]?.name || "Items" }, t);
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
      if (id) {
        logIdRef.current = id;
        void getUserCompanyId(user?.id).then((company_id) => logTurn(id, { user_id: user?.id, company_id, quote_id: quoteId, transcript: t, plan, matches: planMatches(bd), status: "planned" }, true));
      }
      const clientMsg = plan.client && !meta?.customer_id ? await lookupClient(plan.client) : "";
      const lines = bd.areas.flatMap((a) => a.lines);
      const n = lines.filter(isSaveable).length;
      const flagged = lines.length - n;
      setBreakdown(bd.areas.length ? bd : null);
      if (!n && !flagged) return [clientMsg, "I couldn't make any lines from that. Try: room, unit size and brand, piping metres, extras."].filter(Boolean).join(" ");
      return [
        clientMsg,
        `${n} line${n === 1 ? "" : "s"} across ${bd.areas.length} area${bd.areas.length === 1 ? "" : "s"}, ${rand(sceneSubtotal(bd))} excl. VAT before standard install.`,
        flagged ? `${flagged} need${flagged === 1 ? "s" : ""} a tap on the card.` : "Check the card, then tap Confirm.",
        "Nothing is saved yet.",
      ].filter(Boolean).join(" ");
    } finally {
      setPlanning(false);
    }
  }, [products, bundles, templates, services, areas, quoteId, meta?.customer_id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useRegisterMandyActions({
    quote_scene: async ({ transcript: t }) => {
      const message = await runScene(String(t || ""));
      setReply(message);
      return { ok: true, message };
    },
  });

  /* ───── one Confirm → live quote ───── */
  const confirmScene = async () => {
    if (!breakdown) return;
    if (!breakdown.areas.some((a) => a.lines.some(isSaveable))) { speak("Nothing priced to save yet."); return; }
    setSaving(true);
    const logId = logIdRef.current;
    try {
      const sortStart = items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0;
      const { ids, notes } = await writeBreakdown(breakdown, { addItem, addArea: addArea as any, areas, sortStart, templates, bundles: bundles as any, products });
      if (ids.length) committedRef.current.push(ids);
      if (logId) void logTurn(logId, { status: "confirmed", matches: planMatches(breakdown), result: { ids, notes } });
      setBreakdown(null);
      setTranscript("");
      onChanged?.();
      speak(`Saved ${ids.length} line${ids.length === 1 ? "" : "s"}, including the standard install.${notes.length ? ` Note: ${notes.join(". ")}.` : ""}${meta?.customer_id ? "" : " No client on this quote yet."}`);
      if (notes.length) toast({ title: "Standard install", description: notes.join(". ") });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Try again.";
      if (logId) void logTurn(logId, { status: "failed", result: { error: msg } });
      toast({ title: "Could not save", description: msg, variant: "destructive" });
      speak("Saving failed part-way — check the quote and confirm again for what's left.");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (logIdRef.current) void logTurn(logIdRef.current, { status: "cancelled" });
    setBreakdown(null);
    speak("Discarded — nothing was saved.");
  };

  const undoLastConfirm = async () => {
    const ids = committedRef.current.pop();
    if (!ids?.length) { speak("Nothing to undo."); return; }
    for (const id of ids) await deleteItem(id);
    onChanged?.();
    speak(`Removed the last ${ids.length === 1 ? "line" : `${ids.length} lines`} from the quote.`);
  };

  const pendingCount = breakdown ? breakdown.areas.flatMap((a) => a.lines).filter(isSaveable).length : 0;

  return (
    <section className="print:hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button type="button" size="sm" onClick={() => { setOpen(true); openMandyQuoteMode(); }} disabled={saving} className="gap-2" aria-label="Ask Mandy in quote mode">
          {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          Ask Mandy
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={reply}>{reply}</p>
        {breakdown && pendingCount > 0 && <Badge variant="secondary">{pendingCount} pending · {rand(sceneSubtotal(breakdown))}</Badge>}
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Open"}</Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {clientPrompt && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {clientPrompt.type === "customer_pick" ? `Heard: “${clientPrompt.query}”` : `Heard: “${clientPrompt.query}” — no client picked.`}
              </p>
              {clientPrompt.type === "customer_pick" && (
                <div className="flex flex-wrap gap-2">
                  {clientPrompt.hits.map((c, i) => (
                    <Button key={c.id} type="button" size="sm" variant="outline" onClick={() => void setCustomer(c)}>
                      {i + 1}. {clientDisplayName(c)} · {c.phone}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setClientPrompt({ type: "no_match", query: clientPrompt.query })}>None of these</Button>
                </div>
              )}
              <VoiceClientOverrideFields
                draft={clientDraft}
                onChange={setClientDraft}
                busy={saving}
                onSaveNew={() => void saveOverrideAsNew()}
                onResearch={() => void lookupClient(clientDraft.name.trim(), false).then(setReply)}
              />
            </div>
          )}

          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (transcript.trim()) void runScene(transcript).then(speak); }}>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={EXAMPLE} rows={3} className="text-sm" disabled={saving || planning} aria-label="Transcript" />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" variant="outline" className="gap-1" disabled={!transcript.trim() || saving || planning}>
                <Sparkles className="h-4 w-4" /> {breakdown ? "Re-build breakdown" : "Build breakdown"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => breakdown && speak(sceneReadBack(breakdown, vatRate))} disabled={!breakdown}>Read back</Button>
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
              onDiscard={discard}
            />
          )}
        </div>
      )}
    </section>
  );
}

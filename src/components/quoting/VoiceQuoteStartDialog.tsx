/**
 * VoiceQuoteStartDialog — the "no quote yet" entry point for quote-by-voice.
 *
 * One short turn: who is the quote for? Finds the client (name / phone via
 * search_customers) or adds one (customers insert), then creates ONE real
 * draft `quotes` row for that customer_id and navigates to
 * /admin/estimates/:id?voice=1 where VoiceQuoteStrip carries on with lines.
 * No parallel voice draft; the estimate page is the only builder surface.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { WavRecorder } from "@/lib/wavRecorder";
import { getUserCompanyId } from "@/lib/tenantUtils";
import { DEFAULT_LEAD_SOURCE } from "@/lib/leadSources";
import { createDraftQuoteForCustomer } from "@/lib/createDraftQuote";
import { parseUtterance } from "@/lib/voiceQuoteKit";
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";

const label = (c: CustomerSearchResult) =>
  [c.company_name, [c.first_name, c.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" — ") || c.phone;

type Phase = "idle" | "listening" | "transcribing" | "working";

export default function VoiceQuoteStartDialog() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reply, setReply] = useState("Who is the quote for? Say a name or number, or “new client Jane Doe 082 123 4567 at 12 Main Road”.");
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [hits, setHits] = useState<CustomerSearchResult[]>([]);
  const [pendingNew, setPendingNew] = useState<{ name: string; address: string | null } | null>(null);
  const recRef = useRef<WavRecorder | null>(null);

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const say = (t: string) => {
    setReply(t);
    if (canSpeak) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(t));
    }
  };

  const openQuoteFor = async (customerId: string, name: string) => {
    setPhase("working");
    try {
      if (!user?.id) throw new Error("Not signed in.");
      const quoteId = await createDraftQuoteForCustomer(user.id, customerId, name);
      say(`Quote opened for ${name}.`);
      setOpen(false);
      navigate(`/admin/estimates/${quoteId}?voice=1`);
    } catch (e) {
      setPhase("idle");
      toast({ title: "Could not open a quote", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  const createCustomer = async (name: string, phone: string, address: string | null) => {
    setPhase("working");
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
        primary_address_line1: address,
        address,
      })
      .select("id")
      .single();
    if (error || !data) {
      setPhase("idle");
      say(`Could not add ${name}: ${error?.message || "unknown error"}.`);
      return;
    }
    await openQuoteFor(data.id, name);
  };

  const handle = async (text: string) => {
    setHeard(text);
    const pick = text.trim().match(/^(?:number |option )?([1-3]|one|two|three|first|second|third)\b/i);
    if (hits.length && pick) {
      const map: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3 };
      const i = (map[pick[1].toLowerCase()] ?? Number(pick[1])) - 1;
      const c = hits[i];
      if (c) { await openQuoteFor(c.id, label(c)); return; }
    }
    const [it] = parseUtterance(text);
    if (!it) { say("Didn't catch that."); return; }

    if (pendingNew && it.kind === "phone") {
      const p = pendingNew; setPendingNew(null);
      await createCustomer(p.name, it.phone, p.address);
      return;
    }
    if (it.kind === "new_client") {
      if (!it.name) { say("What is the client's name?"); return; }
      if (!it.phone) { setPendingNew({ name: it.name, address: it.address ?? null }); say(`Phone number for ${it.name}?`); return; }
      await createCustomer(it.name, it.phone, it.address ?? null);
      return;
    }
    // Anything else is treated as a client lookup (name, phone, company).
    const q = it.kind === "client" ? it.query : it.kind === "phone" ? it.phone : text.trim();
    setPhase("working");
    const { data, error } = await supabase.rpc("search_customers", { search_term: q, max_results: 5 });
    setPhase("idle");
    const found = (error ? [] : (data || [])) as CustomerSearchResult[];
    if (!found.length) { say(`No client matching ${q}. Say new client ${q} with a phone number to add them.`); return; }
    if (found.length === 1) { await openQuoteFor(found[0].id, label(found[0])); return; }
    const top = found.slice(0, 3);
    setHits(top);
    say(`Found ${top.map((c, i) => `${i + 1}. ${label(c)}`).join(", ")}. Which one?`);
  };

  const stopRecording = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setPhase("transcribing");
    try {
      const { base64, bytes } = await rec.stop();
      if (bytes < 2048) throw new Error("That was empty — try again.");
      const { data, error } = await supabase.functions.invoke("voice-quote-parse", { body: { action: "transcribe", audio: base64 } });
      if (error || (data as { error?: string })?.error) throw new Error((data as { error?: string })?.error || error?.message || "Transcription failed.");
      const text = String((data as { transcript?: string }).transcript ?? "").trim();
      setPhase("idle");
      if (!text) { say("Nothing was picked up."); return; }
      await handle(text);
    } catch (e) {
      setPhase("idle");
      toast({ title: "Voice capture failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    }
  };

  const startRecording = async () => {
    if (recRef.current) return;
    try {
      if (canSpeak) window.speechSynthesis.cancel();
      const rec = new WavRecorder();
      let spoke = false;
      await rec.start({
        onSpeechStart: () => { spoke = true; },
        onSilence: () => {
          if (spoke) void stopRecording();
          else { rec.cancel(); recRef.current = null; setPhase("idle"); }
        },
      });
      recRef.current = rec;
      setPhase("listening");
    } catch {
      setPhase("idle");
      toast({ title: "Microphone unavailable", description: "Allow microphone access, or type below.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!open) {
      recRef.current?.cancel();
      recRef.current = null;
      if (canSpeak) window.speechSynthesis.cancel();
      setPhase("idle");
      setHits([]);
      setPendingNew(null);
      setHeard("");
    }
  }, [open, canSpeak]);

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Mic className="h-4 w-4" /> Voice quote
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a quote by voice</DialogTitle>
            <DialogDescription>Find or add the client — the quote opens on their estimate page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-foreground">{reply}</p>
            {heard && <p className="text-xs text-muted-foreground">Heard: “{heard}”</p>}
            {hits.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {hits.map((c, i) => (
                  <Button key={c.id} type="button" size="sm" variant="outline" disabled={phase === "working"} onClick={() => void openQuoteFor(c.id, label(c))}>
                    {i + 1}. {label(c)} · {c.phone}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={phase === "listening" ? "destructive" : "default"}
                onClick={() => (phase === "listening" ? void stopRecording() : void startRecording())}
                disabled={phase === "transcribing" || phase === "working"}
                className="gap-2"
                aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
              >
                {phase === "transcribing" || phase === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : phase === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {phase === "listening" ? "Listening…" : phase === "transcribing" ? "Hearing…" : phase === "working" ? "Working…" : "Speak"}
              </Button>
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (!t) return; setTyped(""); void handle(t); }}
              >
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="or type: Andre Blom / 082… / new client …" disabled={phase === "working"} />
                <Button type="submit" size="sm" variant="secondary" disabled={phase === "working"}>Go</Button>
              </form>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

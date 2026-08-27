import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, Loader2, Mic, Square, Trash2, X } from "lucide-react";
import { WavRecorder } from "@/lib/wavRecorder";
import {
  draftItemToProduct,
  effectivePrice,
  lineTotal,
  matchToCatalog,
  toDraftItems,
  type ParsedVoiceItem,
  type VoiceDraftItem,
} from "@/lib/voiceQuoteMatching";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

interface VoiceQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: PaletteProduct[];
  quoteId?: string | null;
  /** Confirmed items are pushed into the existing shared baskets. */
  onConfirm: (items: Array<{ product: PaletteProduct; quantity: number }>) => void;
}

const rand = (n: number) => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Phase = "idle" | "recording" | "transcribing" | "parsing" | "review";

const VoiceQuoteDialog = ({ open, onOpenChange, products, quoteId, onConfirm }: VoiceQuoteDialogProps) => {
  const { toast } = useToast();
  const recorderRef = useRef<WavRecorder | null>(null);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<VoiceDraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  /** Hands-free: start listening automatically and stop on a natural pause. */
  const [handsFree, setHandsFree] = useState(true);
  const [heardSpeech, setHeardSpeech] = useState(false);
  const [level, setLevel] = useState(0);

  const busy = phase === "transcribing" || phase === "parsing";
  const needsReview = items.some((i) => i.needsReview);
  const total = useMemo(() => items.reduce((sum, i) => sum + lineTotal(i), 0), [items]);

  const reset = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPhase("idle");
    setTranscript("");
    setNotes("");
    setItems([]);
    setHeardSpeech(false);
    setLevel(0);
  };

  const startRecording = useCallback(async (auto = handsFree) => {
    if (recorderRef.current) return;
    try {
      const rec = new WavRecorder();
      setHeardSpeech(false);
      setLevel(0);
      await rec.start(
        auto
          ? {
              onSpeechStart: () => setHeardSpeech(true),
              onLevel: (l) => setLevel(l),
              onSilence: () => void stopRef.current?.(),
            }
          : { onLevel: (l) => setLevel(l), onSpeechStart: () => setHeardSpeech(true) },
      );
      recorderRef.current = rec;
      setPhase("recording");
    } catch {
      toast({
        title: "Microphone unavailable",
        description: "Allow microphone access to build a quote by voice.",
        variant: "destructive",
      });
    }
  }, [handsFree, toast]);


  const runParse = useCallback(async (text: string) => {
    setPhase("parsing");
    const { data, error } = await supabase.functions.invoke("voice-quote-parse", {
      body: { action: "parse", transcript: text, quote_id: quoteId ?? null },
    });
    if (error || (data as { error?: string })?.error) {
      throw new Error((data as { error?: string })?.error || error?.message || "Could not read those line items.");
    }
    const payload = data as { items: ParsedVoiceItem[]; notes?: string };
    const drafts = toDraftItems(payload.items ?? [], products);
    setItems(drafts);
    setNotes(payload.notes ?? "");
    setPhase("review");
    if (!drafts.length) {
      toast({ title: "Nothing to add", description: "No line items were recognised — try again.", variant: "destructive" });
    }
  }, [products, quoteId, toast]);

  const stopRecording = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setPhase("transcribing");
    try {
      const { base64, bytes } = await rec.stop();
      if (bytes < 2048) throw new Error("That recording was empty — please try again.");
      const { data, error } = await supabase.functions.invoke("voice-quote-parse", {
        body: { action: "transcribe", audio: base64 },
      });
      if (error || (data as { error?: string })?.error) {
        throw new Error((data as { error?: string })?.error || error?.message || "Transcription failed.");
      }
      const text = String((data as { transcript?: string }).transcript ?? "").trim();
      if (!text) throw new Error("Nothing was picked up from the microphone.");
      setTranscript(text);
      await runParse(text);
    } catch (e) {
      setPhase("idle");
      toast({
        title: "Voice capture failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };
  stopRef.current = stopRecording;

  // Hands-free: start listening as soon as the dialog opens, and after each
  // batch is reviewed the operator can just keep talking (mic button) instead
  // of hunting for a record control.
  useEffect(() => {
    if (!open || !handsFree) return;
    if (phase !== "idle") return;
    const t = window.setTimeout(() => void startRecording(true), 250);
    return () => window.clearTimeout(t);
  }, [open, handsFree, phase, startRecording]);

  useEffect(() => {
    if (open) return;
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, [open]);



  const patch = (id: string, changes: Partial<VoiceDraftItem>) =>
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, ...changes };
        next.needsReview = !next.product && !(Number(next.manualPrice) > 0);
        return next;
      }),
    );

  const rematch = (item: VoiceDraftItem, terms: string) => {
    const { product, confidence } = matchToCatalog(terms, products, 0.4);
    patch(item.id, { searchTerms: terms, product, confidence });
  };

  const audit = async (confirmed: boolean) => {
    await supabase.functions.invoke("voice-quote-parse", {
      body: {
        action: "audit",
        confirmed,
        quote_id: quoteId ?? null,
        transcript,
        items: items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
          unit_price: effectivePrice(i),
          product_id: i.product?.id ?? null,
          matched: !!i.product,
        })),
      },
    });
  };

  const confirm = async () => {
    if (!items.length || needsReview) return;
    setSaving(true);
    try {
      onConfirm(items.map((i) => ({ product: draftItemToProduct(i), quantity: Number(i.quantity) || 1 })));
      await audit(true);
      toast({ title: `Added ${items.length} voice line item(s) to the quote` });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Could not add the items",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (items.length) await audit(false);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void cancel())}>
      <DialogContent className="max-w-4xl bg-card p-0 gap-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base text-foreground">
            <Mic className="h-4 w-4 text-primary" /> Build with voice
          </DialogTitle>
          <DialogDescription className="text-xs">
            Speak the line items, e.g. “Add a 3-ton Daikin split unit, install labour 2 days and 15 metres of ducting”.
            Nothing is added to the quote until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {phase === "recording" ? (
              <Button variant="destructive" onClick={() => void stopRecording()} className="gap-2">
                <Square className="h-4 w-4" /> {handsFree ? "Stop now" : "Stop & parse"}
              </Button>
            ) : (
              <Button onClick={() => void startRecording(handsFree)} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                {items.length ? "Speak again" : "Start speaking"}
              </Button>
            )}
            {phase === "recording" && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full bg-destructive animate-pulse"
                  style={{ transform: `scale(${1 + Math.min(level, 1) * 1.6})` }}
                />
                {heardSpeech
                  ? handsFree
                    ? "Listening — pause when you're done"
                    : "Listening…"
                  : "Waiting for you to speak…"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Switch id="voice-hands-free" checked={handsFree} onCheckedChange={setHandsFree} />
              <Label htmlFor="voice-hands-free" className="text-xs text-muted-foreground">
                Hands-free
              </Label>
            </div>
            {phase === "transcribing" && <span className="text-xs text-muted-foreground">Transcribing…</span>}
            {phase === "parsing" && <span className="text-xs text-muted-foreground">Matching against the catalog…</span>}
          </div>

          {transcript && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Heard</p>
              <p className="text-sm text-foreground">{transcript}</p>
              {notes && <p className="mt-2 text-xs text-muted-foreground">{notes}</p>}
            </div>
          )}

          {items.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                    <th className="px-2 py-2 text-left font-medium">Item</th>
                    <th className="px-2 py-2 text-left font-medium">Catalog match</th>
                    <th className="px-2 py-2 text-right font-medium">Qty</th>
                    <th className="px-2 py-2 text-left font-medium">Unit</th>
                    <th className="px-2 py-2 text-right font-medium">Unit price</th>
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-border/60 align-top last:border-0">
                      <td className="px-2 py-2">
                        <Input
                          value={item.name}
                          onChange={(e) => patch(item.id, { name: e.target.value })}
                          className="h-8 text-xs"
                        />
                        {item.description && (
                          <p className="mt-1 text-[11px] text-muted-foreground">{item.description}</p>
                        )}
                      </td>
                      <td className="px-2 py-2 min-w-[200px]">
                        {item.product ? (
                          <div className="space-y-1">
                            <Badge variant="secondary" className="text-[10px]">
                              {Math.round(item.confidence * 100)}% match
                            </Badge>
                            <p className="text-foreground">{item.product.short_name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {item.product.brand} · {item.product.supplier_name}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="destructive" className="gap-1 text-[10px]">
                              <AlertTriangle className="h-3 w-3" /> No confident match
                            </Badge>
                            <Input
                              value={item.searchTerms}
                              onChange={(e) => rematch(item, e.target.value)}
                              placeholder="Search the catalog…"
                              className="h-8 text-xs"
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => patch(item.id, { quantity: Number(e.target.value) })}
                          className="h-8 w-20 text-right text-xs"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          value={item.unit}
                          onChange={(e) => patch(item.id, { unit: e.target.value })}
                          className="h-8 w-16 text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        {item.product ? (
                          <span className="text-foreground">{rand(effectivePrice(item))}</span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.manualPrice ?? ""}
                            placeholder="Confirm price"
                            onChange={(e) =>
                              patch(item.id, { manualPrice: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className="h-8 w-28 text-right text-xs"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-foreground">{rand(lineTotal(item))}</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {needsReview && (
            <p className="flex items-center gap-2 text-xs text-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Some items could not be matched to the supplier catalog — pick a product or confirm a price before adding
              them. Nothing is guessed.
            </p>
          )}
        </div>

        <DialogFooter className="items-center justify-between gap-2 border-t border-border px-4 py-3 sm:justify-between">
          <span className="text-sm font-medium text-foreground">
            {items.length} item(s) · {rand(total)} excl. VAT
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void cancel()} disabled={saving}>
              <X className="mr-1.5 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={() => void confirm()} disabled={saving || !items.length || needsReview}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Add to quote
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VoiceQuoteDialog;

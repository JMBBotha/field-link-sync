import { useEffect, useRef, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquare, Mic, Send, Sparkle, X } from "lucide-react";
import ResultTable, { TOOL_LABELS, type Row, type Structured } from "@/components/admin/nl/ResultTable";
import VoiceAssistantPanel from "@/components/admin/nl/VoiceAssistantPanel";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  data?: Structured[];
}

interface PendingConfirmation {
  /** nl_audit_log row id when the write came from a voice session. */
  id?: string;
  tool_name: string;
  args: Record<string, unknown>;
}


const SUGGESTIONS = [
  "Show me emergency leads from this week",
  "Which invoices are more than 30 days overdue?",
  "Who is available for dispatch right now?",
  "What's sitting in the unassigned queue?",
];

type AssistantMode = "text" | "voice";

interface NLCommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The header star icon opens straight into voice mode. */
  initialMode?: AssistantMode;
}

const NLCommandBar = ({ open, onOpenChange, initialMode = "text" }: NLCommandBarProps) => {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<AssistantMode>(initialMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceAssistant();

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    if (initialMode === "text") setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, initialMode]);

  // Star icon / Voice tab: start the call as soon as voice mode is shown.
  useEffect(() => {
    if (open && mode === "voice" && voice.status === "idle") void voice.start();
  }, [open, mode, voice.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // End the call whenever the panel closes or the user switches back to text.
  useEffect(() => {
    if (!open || mode !== "voice") {
      if (voice.status === "live" || voice.status === "connecting") voice.stop();
    }
  }, [open, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // A write tool queued during the voice call falls back to the same modal.
  // Answered pendings are remembered so a re-poll can never resurrect them.
  const answeredPendingIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const p = voice.pending;
    if (!p || pending) return;
    if (p.id && answeredPendingIds.current.has(p.id)) return;
    setPending(p);
  }, [voice.pending]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const callFunction = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("nl-query", { body: payload });
    if (error) throw new Error(error.message || "Assistant request failed");
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as {
      type: "answer" | "confirmation_required" | "executed";
      message: string;
      data?: Structured[];
      confirmation?: PendingConfirmation;
    };
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await callFunction({
        messages: nextMessages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.message, data: res.data }]);
      if (res.type === "confirmation_required" && res.confirmation) setPending(res.confirmation);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      setMessages((prev) => [...prev, { role: "assistant", content: message }]);
      toast({ title: "Assistant error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const confirmAction = async () => {
    if (!pending) return;
    const answered = pending;
    if (answered.id) answeredPendingIds.current.add(answered.id);
    // Close first: the answer is final, the modal must never come back.
    setPending(null);
    setConfirming(true);
    try {
      const res = await callFunction({ confirm: { tool_name: answered.tool_name, args: answered.args } });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message,
          data: res.data ? [{ tool_name: answered.tool_name, rows: res.data as unknown as Row[] }] : undefined,
        },
      ]);
      toast({ title: "Action completed", description: res.message });
      voice.clearPending(res.message, { id: answered.id, status: "executed" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Action failed";
      toast({ title: "Action failed", description: message, variant: "destructive" });
      voice.clearPending(message, { id: answered.id, status: "cancelled" });
    } finally {
      setConfirming(false);
    }
  };

  const cancelAction = () => {
    const answered = pending;
    if (answered?.id) answeredPendingIds.current.add(answered.id);
    setPending(null);
    voice.clearPending("Cancelled — nothing was changed.", { id: answered?.id, status: "cancelled" });
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled — nothing was changed." }]);
  };


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 gap-0 bg-card">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-base flex items-center gap-2">
              <Sparkle className="h-4 w-4 text-primary" />
              Ask your operations assistant
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ask about leads, jobs, invoices, staff and the unassigned queue. Changes always need your confirmation.
            </DialogDescription>
            <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5">
              {(["text", "voice"] as AssistantMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "text" ? <MessageSquare className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  {m === "text" ? "Text" : "Voice"}
                </button>
              ))}
            </div>
          </DialogHeader>

          {mode === "voice" ? (
            <VoiceAssistantPanel
              status={voice.status}
              error={voice.error}
              transcript={voice.transcript}
              results={voice.results}
              assistantSpeaking={voice.assistantSpeaking}
              muted={voice.muted}
              onStart={() => void voice.start()}
              onStop={voice.stop}
              onToggleMute={voice.toggleMute}
            />
          ) : (
          <>

          <div ref={scrollRef} className="max-h-[55vh] min-h-[220px] overflow-y-auto px-4 py-3 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try one of these:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{m.content}</p>
                    {m.data?.map((block, bi) => <ResultTable key={bi} block={block} />)}
                  </>
                )}
              </div>
            ))}

            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border px-4 py-3"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Show overdue invoices in Pretoria"
              className="flex-1"
              disabled={loading}
            />
            <Button type="submit" size="icon" disabled={loading || !input.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pending} onOpenChange={(o) => !o && cancelAction()}>
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="text-base">Confirm action</DialogTitle>
            <DialogDescription className="text-xs">
              This will change your data. Review the exact details before confirming.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {pending ? TOOL_LABELS[pending.tool_name] ?? pending.tool_name : ""}
            </p>
            <ScrollArea className="max-h-52 rounded-md border border-border bg-muted/40 p-3">
              <pre className="text-xs text-foreground whitespace-pre-wrap">
                {JSON.stringify(pending?.args ?? {}, null, 2)}
              </pre>
            </ScrollArea>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={cancelAction} disabled={confirming}>
              <X className="mr-1.5 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={confirmAction} disabled={confirming}>
              {confirming ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default NLCommandBar;

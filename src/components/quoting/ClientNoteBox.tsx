import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useQuoteContext } from "@/contexts/QuoteContext";

/** Staff editor for quotes.notes — the note prints on the client PDF as "Overview". */
export default function ClientNoteBox({ onChanged }: { onChanged?: () => void }) {
  const { meta, updateQuote } = useQuoteContext();
  const saved = ((meta as any)?.notes as string | null) ?? "";
  const [text, setText] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => { setText(saved); }, [saved]);
  const save = async () => {
    if (text.trim() === saved.trim()) return;
    setState("saving");
    await updateQuote({ notes: text.trim() || null });
    setState("saved");
    onChanged?.();
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3 print:hidden" data-pdf-hide data-html2canvas-ignore>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor="client-note" className="text-sm font-semibold">Note for client</label>
        <span className="text-xs text-muted-foreground">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved · shows on the quote" : "Shows on the quote the client sees"}
        </span>
      </div>
      <Textarea
        id="client-note"
        value={text}
        onChange={(e) => { setText(e.target.value); setState("idle"); }}
        onBlur={() => void save()}
        placeholder="e.g. Price includes removal of the old unit. We can start next week."
        rows={3}
      />
    </div>
  );
}

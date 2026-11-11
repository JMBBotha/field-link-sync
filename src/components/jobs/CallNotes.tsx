import { useState } from "react";
import LinkifiedText from "@/components/shared/LinkifiedText";
import { isCallDump, oneLineSummary } from "@/lib/callSummary";

/** Long call transcripts stay behind "Show call notes". Ordinary notes stay visible. */
export default function CallNotes({ notes, editable, onEdit }: {
  notes: string;
  editable?: boolean;
  onEdit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!isCallDump(notes)) {
    return (
      <div
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
        onClick={() => editable && onEdit?.()}
        className="block w-full whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 text-left text-sm"
        data-testid="booking-notes-text"
      >
        <LinkifiedText text={notes} />
      </div>
    );
  }
  const line = oneLineSummary({ notes }) || "Phone call";
  return (
    <div className="space-y-1" data-testid="booking-call-notes">
      <p className="text-sm">{line}</p>
      <button type="button" className="fl-btn-text px-0" aria-expanded={open} data-testid="show-call-notes" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide call notes" : "Show call notes"}
      </button>
      {open && (
        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 text-sm" data-testid="call-notes-body">
          <LinkifiedText text={notes} />
        </div>
      )}
    </div>
  );
}

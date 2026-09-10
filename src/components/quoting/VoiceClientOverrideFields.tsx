/**
 * VoiceClientOverrideFields — typed override for a misheard client.
 *
 * STT is often ~90% right ("Vicus Kuman" for Wicus Schoeman), so whenever the
 * voice flow shows pick chips or an "add as new" path, the user can correct the
 * name / phone / address / email by keyboard and save the client from those
 * edited values. Purely presentational; the parent owns create/search.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export interface VoiceClientDraft {
  name: string;
  phone: string;
  address: string;
  email: string;
}

export const emptyClientDraft = (name = ""): VoiceClientDraft => ({ name, phone: "", address: "", email: "" });

interface Props {
  draft: VoiceClientDraft;
  onChange: (draft: VoiceClientDraft) => void;
  onSaveNew: () => void;
  onResearch?: () => void;
  busy?: boolean;
}

export default function VoiceClientOverrideFields({ draft, onChange, onSaveNew, onResearch, busy }: Props) {
  const set = (k: keyof VoiceClientDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...draft, [k]: e.target.value });
  const ready = draft.name.trim().length > 1 && draft.phone.trim().length >= 6;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
      <p className="text-xs text-muted-foreground">Not right? Type the correct details:</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={draft.name} onChange={set("name")} placeholder="Name *" aria-label="Client name" className="h-9 text-sm" />
        <Input value={draft.phone} onChange={set("phone")} placeholder="Phone *" inputMode="tel" aria-label="Client phone" className="h-9 text-sm" />
        <Input value={draft.address} onChange={set("address")} placeholder="Address" aria-label="Client address" className="h-9 text-sm" />
        <Input value={draft.email} onChange={set("email")} placeholder="Email (optional)" inputMode="email" aria-label="Client email" className="h-9 text-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onSaveNew} disabled={busy || !ready} className="gap-1">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save as new client
        </Button>
        {onResearch && (
          <Button type="button" size="sm" variant="outline" onClick={onResearch} disabled={busy || draft.name.trim().length < 2}>
            Search this name
          </Button>
        )}
      </div>
      {!ready && <p className="text-[11px] text-muted-foreground">Name and phone are needed to save a new client.</p>}
    </div>
  );
}

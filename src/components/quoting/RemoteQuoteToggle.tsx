import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * "Phone / online quote (no site visit)" switch in the quote builder (Johan 2026-10-18 22:08).
 * On: terms section 12 shows on the PDF / client link and the install gets an on-site check.
 * Sam, phone Mandy and phone/website leads switch it on automatically (DB trigger).
 * Turning it off by hand is remembered (remote_quote_source = 'manual_off') so it is not re-flagged.
 */
export default function RemoteQuoteToggle({ quoteId, value, source, onChanged }: {
  quoteId: string; value: boolean; source?: string | null; onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const auto = value && source && !source.startsWith("manual");
  const set = async (next: boolean) => {
    setBusy(true);
    const { error } = await (supabase.from("quotes") as any)
      .update({ remote_quote: next, remote_quote_source: next ? "manual" : "manual_off" })
      .eq("id", quoteId);
    setBusy(false);
    if (error) { toast({ title: "Couldn't update the quote", description: error.message, variant: "destructive" }); return; }
    onChanged?.();
  };
  return (
    <label data-testid="remote-quote-toggle" className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm print:hidden" data-html2canvas-ignore data-pdf-hide>
      <Switch checked={value} disabled={busy} onCheckedChange={(v) => void set(!!v)} aria-label="Phone or online quote (no site visit)" className="mt-0.5" />
      <span className="min-w-0">
        <span className="font-semibold text-ink">Phone / online quote (no site visit)</span>
        <span className="block text-xs text-ink-secondary">
          {value
            ? `Adds the "Quotes made by phone or online" terms. The technician checks the site before starting.${auto ? " Set automatically from the lead." : ""}`
            : "Switch on if this quote was made without seeing the site."}
        </span>
      </span>
    </label>
  );
}

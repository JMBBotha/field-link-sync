import { useState } from "react";
import { Lock, Unlock, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { ReasonDialog } from "./QuoteAcceptedLock";

/**
 * Builder banners for the on-site check (Johan 2026-10-18):
 * - "Confirmed & locked": prices can't change; only an admin can unlock, with a reason (logged).
 * - Updated quote (variation) still to be priced: rep/Johan prices the "to be priced" lines, then
 *   "Finalise updated quote" applies the threshold/discount rules before sending with the normal Send.
 */
export default function QuoteLockBanner({ quoteId, lockedAt, lockedReason, isVariation, status, summaryLine, onChanged }: {
  quoteId: string; lockedAt?: string | null; lockedReason?: string | null; isVariation?: boolean | null;
  status?: string | null; summaryLine?: string | null; onChanged?: () => void;
}) {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [askReason, setAskReason] = useState(false);
  // 'accepted' locks (0029) are shown by QuoteAcceptedLock on the estimate page, with the admin actions.
  if (lockedReason === "accepted") return null;
  if (!lockedAt && !isVariation) return null;

  const unlock = async (reason: string) => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)("unlock_quote", { p_quote_id: quoteId, p_reason: reason.trim() });
    setBusy(false);
    if (error) { toast({ title: "Couldn't unlock", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Quote unlocked" });
    setAskReason(false);
    onChanged?.();
  };
  const finalise = async () => {
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("finalise_variation_quote", { p_quote_id: quoteId });
    setBusy(false);
    if (error) { toast({ title: "Couldn't finalise", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Updated quote finalised", description: (data as any)?.summary_line || "Now send it to the client with Send." });
    onChanged?.();
  };

  return (
    <div className="space-y-2 print:hidden" data-html2canvas-ignore data-pdf-hide>
      {lockedAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="quote-locked-banner">
          <Lock className="h-4 w-4" />
          <span className="flex-1 font-semibold">Confirmed &amp; locked{lockedReason ? ` (${lockedReason.replace(/_/g, " ")})` : ""} · {new Date(lockedAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</span>
          {isAdmin && <Button size="sm" variant="outline" className="h-9 gap-1" disabled={busy} onClick={() => setAskReason(true)}><Unlock className="h-3.5 w-3.5" /> Unlock</Button>}
        </div>
      )}
      {isVariation && !lockedAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900" data-testid="variation-banner">
          <Wrench className="h-4 w-4" />
          <span className="min-w-0 flex-1">
            <b>Updated quote from the site check.</b>{" "}
            {status === "draft" ? "Price the “to be priced” lines, then finalise and send it to the client." : summaryLine || "Sent to the client for approval."}
          </span>
          {status === "draft" && <Button size="sm" className="h-9" disabled={busy} onClick={finalise}>Finalise updated quote</Button>}
        </div>
      )}
      <ReasonDialog open={askReason} onOpenChange={setAskReason} busy={busy} testId="site-check-unlock-dialog" title="Unlock confirmed quote"
        label="Why are you unlocking this confirmed quote?" description="Only admins can do this. Your reason is saved in the log."
        confirmLabel="Unlock" onConfirm={(r) => void unlock(r)} />
    </div>
  );
}

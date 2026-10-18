/**
 * Updated quote after the on-site check (terms 12). Replaces the normal Accept flow on a variation quote:
 * the client approves (name) or declines; approving lets the technician go ahead, declining cancels the
 * installation and the deposit is refunded in full (12.5).
 */
import { useState } from "react";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export interface VariationSummary {
  gross_excl?: number; discount_pct?: number; discount_excl?: number; net_excl?: number;
  charged?: boolean; absorbed?: boolean; summary_line?: string | null;
}
const fmtR = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n || 0);

export default function VariationResponseCard({ token, status, summary, total, parentTotal, parentNumber, defaultName, acceptedBy }: {
  token: string; status: string; summary: VariationSummary | null; total: number; parentTotal: number | null;
  parentNumber: string | null; defaultName?: string; acceptedBy?: string | null;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(defaultName || "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "declined" | null>(status === "accepted" ? "approved" : status === "declined" ? "declined" : null);

  const respond = async (approve: boolean) => {
    if (approve && !name.trim()) { toast({ title: "Please enter your name", variant: "destructive" }); return; }
    if (!approve && !window.confirm("Decline the updated quote? The installation will be cancelled and your deposit refunded in full.")) return;
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("respond_job_variation", { p_token: token, p_approve: approve, p_name: name.trim() || null });
    setBusy(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Couldn't save your answer", description: error?.message || "Please contact us.", variant: "destructive" });
      return;
    }
    setDone((data as any).status === "approved" ? "approved" : "declined");
  };

  const s = summary || {};
  const diff = parentTotal != null ? total - parentTotal : null;
  return (
    <Card className="rounded-2xl border-0 border-t-4 border-t-[#F7941D] shadow-lg print:hidden" data-testid="variation-card">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-lg font-bold text-foreground">Updated quote after the site check</h2>
          <p className="text-sm text-muted-foreground">Our technician checked the installation on site{parentNumber ? ` (original quote ${parentNumber})` : ""}.</p>
        </div>
        {s.charged && (
          <div className="rounded-xl bg-blue-50 p-3 text-sm" data-testid="variation-discount">
            <div className="flex justify-between"><span>Additional work</span><b>{fmtR(Number(s.gross_excl) || 0)}</b></div>
            <div className="flex justify-between text-emerald-700"><span>Our discount {Number(s.discount_pct) || 0}%</span><b>−{fmtR(Number(s.discount_excl) || 0)}</b></div>
            <div className="flex justify-between border-t pt-1 font-bold"><span>You pay</span><span>{fmtR(Number(s.net_excl) || 0)}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">Amounts excl. VAT</p>
          </div>
        )}
        {s.absorbed && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">The extra work is at no charge to you.</p>}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {parentTotal != null && <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Was</p><b>{fmtR(parentTotal)}</b></div>}
          <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Now (incl. VAT)</p><b className="text-[#0B4FA8]">{fmtR(total)}</b>
            {diff != null && diff > 0 && <p className="text-xs text-muted-foreground">+{fmtR(diff)}, added to your balance</p>}</div>
        </div>
        {done === "approved" ? (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800" data-testid="variation-approved"><CheckCircle className="h-5 w-5" /> Approved{acceptedBy ? ` by ${acceptedBy}` : ""}. Our technician can go ahead.</p>
        ) : done === "declined" ? (
          <p className="flex items-center gap-2 rounded-xl bg-red-50 p-3 font-semibold text-red-800" data-testid="variation-declined"><XCircle className="h-5 w-5" /> Declined. The installation is cancelled and we will refund your deposit in full.</p>
        ) : status === "draft" ? (
          <p className="text-sm text-muted-foreground">We are still pricing the changes. You'll be able to approve them shortly.</p>
        ) : (
          <div className="space-y-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className="h-11 rounded-xl" aria-label="Your name" />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 flex-1 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700" disabled={busy} onClick={() => respond(true)} data-testid="variation-approve">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />} Approve and go ahead
              </Button>
              <Button variant="outline" className="h-11 flex-1 rounded-xl border-red-300 text-red-700" disabled={busy} onClick={() => respond(false)} data-testid="variation-decline">
                <XCircle className="mr-2 h-4 w-4" /> Decline
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">If you decline, the installation is cancelled and we will refund your deposit in full.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

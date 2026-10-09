import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { countdown, offerSummary, type InstallOffer } from "@/lib/installHandoff";

/** Technician inbox for installation offers (first to accept wins). No money is shown. */
const InstallOfferCards = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const { data: offers = [] } = useQuery({
    queryKey: ["my-install-offers", user?.id],
    enabled: !!user,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("my_install_offers");
      if (error) throw error;
      return (data ?? []) as InstallOffer[];
    },
  });
  const live = offers.filter((o) => new Date(o.respond_by).getTime() > Date.now());
  if (!live.length) return null;

  const respond = async (o: InstallOffer, accept: boolean) => {
    setBusy(o.offer_id);
    const { data, error } = await (supabase as any).rpc(accept ? "claim_install_offer" : "decline_install_offer", { p_offer_id: o.offer_id });
    setBusy(null);
    qc.invalidateQueries({ queryKey: ["my-install-offers"] });
    if (error || !data?.ok) {
      toast({ title: accept ? "Couldn't take it" : "Couldn't decline", description: error?.message || data?.message, variant: "destructive" });
      return;
    }
    if (accept) {
      toast({ title: "Installation is yours" });
      navigate(`/field/jobs/${o.job_id}`);
    }
  };

  return (
    <div className="space-y-2" data-testid="install-offers">
      {live.map((o) => (
        <div key={o.offer_id} data-testid="install-offer-card" className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><HardHat className="h-4 w-4" /> Installation offer · {o.client}</p>
              <p className="mt-0.5 text-xs text-muted-foreground" data-testid="install-offer-summary">{offerSummary(o)}</p>
            </div>
            <span className="shrink-0 rounded-md bg-background/70 px-2 py-0.5 font-mono text-xs" title="Time left to accept">{countdown(o.respond_by)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" disabled={busy === o.offer_id} onClick={() => respond(o, false)}>Decline</Button>
            <Button variant="brand" className="h-11" disabled={busy === o.offer_id} onClick={() => respond(o, true)} data-testid="install-offer-accept">
              {busy === o.offer_id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Accept
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default InstallOfferCards;

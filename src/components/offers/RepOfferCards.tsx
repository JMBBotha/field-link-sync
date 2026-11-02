import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { RepOffer } from "@/lib/requestOffers";

const ago = (iso: string, now: number) => { const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)); return m < 1 ? "just now" : `${m} min ago`; };

/** One offer. Before accept the server only sends type + rough area (my_request_offers masks it). */
export function RepOfferCard({ offer, now = Date.now(), busy, onAccept, onPass }: { offer: RepOffer; now?: number; busy?: boolean; onAccept?: () => void; onPass?: () => void }) {
  const open = offer.state === "open";
  return (
    <div data-testid="rep-offer" data-state={offer.state} className="rounded-2xl bg-[#1E3A5F] p-4 text-white shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-[#3D9BEB] px-2.5 py-0.5 text-xs font-semibold">{offer.job_type}</span>
        <span className="text-xs text-white/70">{ago(offer.offered_at, now)}</span>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-lg font-semibold"><MapPin className="h-4 w-4" />{offer.area}</p>
      {open && <p className="mt-1 text-xs text-white/70">Client details show once you accept. First to accept gets it.</p>}
      {offer.state === "accepted" && <div className="mt-2 text-sm"><p className="font-semibold">{offer.customer_name}</p><p>{offer.phone}</p><p className="text-white/80">{offer.address}</p></div>}
      {offer.state === "taken" && <p className="mt-2 text-sm font-semibold text-white/80">Taken</p>}
      {open && <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="min-h-11 border-white/40 bg-transparent text-white hover:bg-white/10" disabled={busy} onClick={onPass} data-testid="offer-pass">Pass</Button>
        <Button className="fl-btn-primary min-h-11" disabled={busy} onClick={onAccept} data-testid="offer-accept">Accept</Button>
      </div>}
    </div>
  );
}

export default function RepOfferCards() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const { data = [] } = useQuery({
    queryKey: ["my-request-offers"], refetchInterval: 30000,
    queryFn: async () => { const { data, error } = await (supabase.rpc as any)("my_request_offers"); if (error) return []; return (data || []) as RepOffer[]; },
  });
  const shown = data.filter((o) => o.state === "open" || (o.state === "accepted" && now - new Date(o.offered_at).getTime() < 3600e3));
  if (!shown.length) return null;
  const act = async (o: RepOffer, fn: "accept_request_offer" | "pass_request_offer") => {
    setBusy(o.offer_id);
    const { data: r, error } = await (supabase.rpc as any)(fn, { p_offer: o.offer_id });
    setBusy(null);
    if (error) toast.error(error.message); else if (r === "taken") toast.info("Another rep accepted this one first"); else if (r === "accepted") toast.success("It's yours. Client details are on the card.");
    qc.invalidateQueries({ queryKey: ["my-request-offers"] });
  };
  return (
    <section className="space-y-2" data-testid="rep-offers">
      <h2 className="text-sm font-semibold">New sale offers</h2>
      {shown.map((o) => <RepOfferCard key={o.offer_id} offer={o} now={now} busy={busy === o.offer_id} onAccept={() => act(o, "accept_request_offer")} onPass={() => act(o, "pass_request_offer")} />)}
    </section>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MapPin, Clock, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface OfferRow {
  id: string;
  lead_id: string;
  offer_type: "sales_estimate" | "service_call";
  distance_km: number | null;
  expires_at: string;
  status: string;
  lead?: {
    customer_name: string | null;
    customer_address: string | null;
    service_type: string | null;
    priority: string | null;
  } | null;
}

const countdown = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

/** Realtime Accept/Decline cards for job offers made to the signed-in staff member. */
const OfferCards = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("offers")
      .select("id, lead_id, offer_type, distance_km, expires_at, status, lead:leads(customer_name, customer_address, service_type, priority)")
      .eq("staff_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    setOffers((data as unknown as OfferRow[]) ?? []);
  };

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel("offers-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers", filter: `staff_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const accept = async (offer: OfferRow) => {
    setBusyId(offer.id);
    try {
      const { data, error } = await supabase.functions.invoke("accept-offer", {
        body: { offer_id: offer.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: "Offer accepted", description: "Job created and assigned to you." });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["jobs-list"] });
      await load();
      if (data?.job_id) navigate(`/admin/jobs/${data.job_id}`);
    } catch (err: any) {
      toast({
        title: "Couldn't accept offer",
        description: err?.message ?? "It may already have been claimed.",
        variant: "destructive",
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (offer: OfferRow) => {
    setBusyId(offer.id);
    await supabase
      .from("offers")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", offer.id);
    toast({ title: "Offer declined" });
    await load();
    setBusyId(null);
  };

  if (!offers.length) return null;

  return (
    <div className="space-y-2">
      {offers.map((offer) => (
        <Card
          key={offer.id}
          className="p-3 border-primary/40 bg-card/70 backdrop-blur-md shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="default" className="text-[10px]">
                  {offer.offer_type === "sales_estimate" ? "Quote opportunity" : "Service call"}
                </Badge>
                {offer.lead?.priority === "emergency" && (
                  <Badge variant="destructive" className="text-[10px]">Emergency</Badge>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" /> {countdown(offer.expires_at)}
                </span>
              </div>
              <p className="mt-1 font-medium text-sm truncate">
                {offer.lead?.customer_name ?? "New lead"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {offer.lead?.service_type ?? "Job"}
                {offer.distance_km != null && ` · ${offer.distance_km} km away`}
              </p>
              {offer.lead?.customer_address && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {offer.lead.customer_address}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                disabled={busyId === offer.id}
                onClick={() => accept(offer)}
              >
                <Check className="h-3.5 w-3.5" /> Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={busyId === offer.id}
                onClick={() => decline(offer)}
              >
                <X className="h-3.5 w-3.5" /> Decline
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default OfferCards;

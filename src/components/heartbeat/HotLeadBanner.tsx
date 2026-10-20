import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSalesHeartbeat } from "@/hooks/useSalesHeartbeat";
import { mmss } from "@/lib/leadClock";
import { toast } from "sonner";

const MUTE_KEY = "fls.hotlead.muted";
/** Soft two-tone chime (Web Audio, low volume). */
function chime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(); const g = ctx.createGain(); g.gain.value = 0.04; g.connect(ctx.destination);
    [660, 880].forEach((f, i) => { const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(g); o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.15); });
    setTimeout(() => ctx.close(), 800);
  } catch { /* audio blocked until first click */ }
}

/** Persistent hot-lead banner on every admin/sales page until someone presses "I'm on it" or logs first contact. Never for techs. */
export default function HotLeadBanner() {
  const navigate = useNavigate();
  const { hb, now, canSee, refetch } = useSalesHeartbeat();
  const [muted, setMuted] = useState(() => typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const lastChime = useRef(0);
  const lead = hb?.hot[0];
  useEffect(() => {
    if (!lead || muted) return;
    if (Date.now() - lastChime.current >= 120_000) { lastChime.current = Date.now(); chime(); }
  }, [lead, muted, now]);
  if (!canSee || !lead) return null;
  const waited = now - new Date(lead.created_at).getTime();
  const more = (hb?.hot.length || 1) - 1;
  const ack = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("acknowledge_lead", { p_lead: lead.id });
    setBusy(false);
    if (error) { toast.error(error.message || "Could not pick up the lead"); return; }
    toast.success(`You're on ${lead.customer_name || "this lead"}`); refetch();
    navigate(`/admin/dispatch?lead=${lead.id}`);
  };
  const toggle = () => { const m = !muted; setMuted(m); localStorage.setItem(MUTE_KEY, m ? "1" : "0"); };
  return (
    <div role="alert" data-testid="hot-lead-banner" className="hb-hot flex flex-wrap items-center gap-3 bg-[#C62828] px-4 py-2 text-[13px] font-semibold text-white lg:px-6">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,.3)]" />
      <span className="min-w-0 flex-1">
        Hot lead · {lead.customer_name || "New lead"} · waiting {mmss(waited)} · not contacted{more > 0 ? ` · +${more} more` : ""}
      </span>
      <button onClick={toggle} aria-label={muted ? "Unmute alert sound" : "Mute alert sound"} className="rounded p-1 hover:bg-white/15">
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <button onClick={ack} disabled={busy} className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-[#C62828]">I'm on it</button>
    </div>
  );
}

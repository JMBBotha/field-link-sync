/**
 * Site check on the tech job sheet (Johan 2026-10-18). Phone/online quotes that include installation must be
 * checked on site before work starts; other install jobs may use it optionally. The tech enters facts and
 * quantities only – never prices. "Variation needed" makes an updated quote: extra pipe is priced from the
 * catalogue and goes straight to the client link; anything else goes to the rep/Johan to price first.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Copy, Hourglass, Lock, Share2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { publicQuoteUrl } from "@/lib/publicAppUrl";
import { btuLabel, recommendBtu, sizeVerdict, type SizingInput } from "@/lib/siteSizing";
import SitePhotosSection from "@/components/photos/SitePhotosSection";

export interface SiteCheckInfo {
  needs_check: boolean; has_install: boolean; remote_quote: boolean;
  status: "confirmed" | "awaiting_pricing" | "awaiting_client" | "declined" | null;
  locked_at: string | null; last_result: string | null; last_checked_at: string | null;
  rooms: { area_id: string | null; name: string; unit_name: string | null; btu: number | null }[];
  quick_adds: { code: string; label: string; unit: "m" | "each" }[];
  variation: { status: string | null; client_token: string | null } | null;
}

export const useSiteCheck = (jobId: string, key?: unknown) =>
  useQuery({
    queryKey: ["job-site-check", jobId, key],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_job_site_check", { p_job_id: jobId });
      if (error) throw error;
      return data as SiteCheckInfo;
    },
  });

/** Why Start/Complete is locked (null = allowed). */
export function siteCheckBlock(info?: SiteCheckInfo | null): string | null {
  if (!info?.needs_check || info.status === "confirmed") return null;
  if (info.status === "awaiting_client") return "Waiting for the client to approve the updated quote.";
  if (info.status === "awaiting_pricing") return "Waiting for the office to price the changes.";
  if (info.status === "declined") return "Client declined – do not proceed.";
  return "Do the site check first.";
}

type RoomState = SizingInput & { pipeM?: number | null; swap?: boolean; extras: Record<string, number> };
const PIPE_INCLUDED_M = 3.5;
const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v.replace(",", ".")) || 0));

/** Optional hints from the rep's site survey (shown as hints / starting answers only; never priced). */
export interface SiteCheckSurveyHints { wall?: string | null; pipeByRoom?: Record<string, number> }

export default function SiteCheckCard({ jobId, leadId, info, onDone, survey }: { jobId: string; leadId?: string | null; info: SiteCheckInfo; onDone: () => void; survey?: SiteCheckSurveyHints | null }) {
  const { toast } = useToast();
  const rooms = info.rooms.length ? info.rooms : [{ area_id: null, name: "Whole job", unit_name: null, btu: null }];
  const extras = info.quick_adds.filter((a) => a.code !== "extra_pipe");
  const [state, setState] = useState<Record<string, RoomState>>({});
  const [checks, setChecks] = useState({ positions: "", electrical: "", wall: "", access: "", obstacles: "" });
  const [notes, setNotes] = useState("");
  // Survey pre-fill: wall type only when it matches one of the options; pipe stays a hint (the tech measures).
  useEffect(() => {
    const w = survey?.wall;
    if (w && ["Brick", "Face brick", "Concrete", "Dry-wall", "Other"].includes(w)) setChecks((c) => (c.wall ? c : { ...c, wall: w }));
  }, [survey?.wall]);
  const surveyPipe = (name: string) => survey?.pipeByRoom?.[name.trim().toLowerCase()];
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(info.needs_check);
  const key = (r: { area_id: string | null }) => r.area_id || "job";
  const room = (r: { area_id: string | null }): RoomState => state[key(r)] || { floorM2: 0, extras: {} };
  const setRoom = (r: { area_id: string | null }, patch: Partial<RoomState>) =>
    setState((s) => ({ ...s, [key(r)]: { ...room(r), ...patch } }));

  const sizing = useMemo(() => rooms.map((r) => {
    const st = room(r);
    const rec = recommendBtu(st);
    return { r, rec, verdict: sizeVerdict(r.btu, rec) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, info.rooms]);

  const items = rooms.flatMap((r) => {
    const st = room(r);
    const out: { code: string; area_id: string | null; qty: number }[] = [];
    const extraPipe = st.pipeM != null ? Math.round(Math.max(0, st.pipeM - PIPE_INCLUDED_M) * 10) / 10 : 0;
    if (extraPipe > 0) out.push({ code: "extra_pipe", area_id: r.area_id, qty: extraPipe });
    for (const [code, qty] of Object.entries(st.extras)) if (qty > 0) out.push({ code, area_id: r.area_id, qty });
    return out;
  });
  const swaps = sizing.filter((s) => room(s.r).swap).map((s) => ({ area_id: s.r.area_id, recommended_btu: s.rec.btu, note: `Quoted ${btuLabel(s.r.btu)}, room ${s.rec.effectiveM2} m²` }));
  const hasChanges = items.length > 0 || swaps.length > 0;

  const submit = async (result: "as_quoted" | "variation_needed") => {
    if (result === "as_quoted" && hasChanges) { toast({ title: "You entered changes", description: "Use “Variation needed”, or clear the extras.", variant: "destructive" }); return; }
    if (result === "variation_needed" && !hasChanges) { toast({ title: "Add what is different", description: "Enter the actual pipe length, an extra, or a unit size change.", variant: "destructive" }); return; }
    if (result === "as_quoted" && !window.confirm("Everything on site matches the quote? Costs will be confirmed and locked.")) return;
    setBusy(true);
    const checklist = { ...checks, rooms: sizing.map((s) => ({ area_id: s.r.area_id, name: s.r.name, quoted_btu: s.r.btu, ...room(s.r), recommended_btu: s.rec.btu, verdict: s.verdict })) };
    const { data, error } = await (supabase.rpc as any)("submit_site_check", {
      p_job_id: jobId, p_checklist: checklist, p_result: result, p_items: items, p_unit_swaps: swaps, p_notes: notes || null,
    });
    setBusy(false);
    if (error) { toast({ title: "Couldn't save the site check", description: error.message, variant: "destructive" }); return; }
    const st = (data as any)?.status;
    toast({ title: st === "confirmed" ? "Costs confirmed and locked" : st === "awaiting_client" ? "Updated quote sent to the client's link" : "Changes sent to the office to price" });
    onDone();
  };

  const link = info.variation?.client_token ? publicQuoteUrl(info.variation.client_token) : null;
  const share = async () => {
    if (!link) return;
    const text = "Please review and approve the updated quote for your installation:";
    try {
      if (navigator.share) await navigator.share({ title: "Updated quote", text, url: link });
      else { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); }
    } catch { /* closed */ }
  };

  const banner = (() => {
    if (info.status === "confirmed") return <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" data-testid="site-check-locked"><Lock className="h-4 w-4" /> Costs confirmed &amp; locked{info.last_checked_at ? ` · ${new Date(info.last_checked_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>;
    if (info.status === "awaiting_pricing") return <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800"><Hourglass className="h-4 w-4" /> The office is pricing the changes. Do not start until the client approves.</p>;
    if (info.status === "awaiting_client") return (
      <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="site-check-awaiting-client">
        <p className="flex items-center gap-2 font-semibold"><Hourglass className="h-4 w-4" /> Updated quote is with the client. Do not start until they approve.</p>
        <p>Give the client the link so they can approve it on their own phone.</p>
        {link && <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-11 gap-1.5" onClick={share}><Share2 className="h-4 w-4" /> Share link with client</Button>
          <Button type="button" variant="outline" className="h-11 gap-1.5" onClick={async () => { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); }}><Copy className="h-4 w-4" /> Copy link</Button>
        </div>}
      </div>
    );
    if (info.status === "declined") return <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800"><XCircle className="h-4 w-4" /> Client declined – do not proceed.</p>;
    return null;
  })();

  if (!info.needs_check && !info.has_install) return null;
  const formOpen = !info.status;
  const sel = (k: keyof typeof checks, opts: string[]) => (
    <select className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm" value={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.value }))}>
      <option value="">Choose…</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  return (
    <Card data-testid="site-check-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4" /> Site check</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${info.needs_check ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-600"}`}>
            {info.needs_check ? "Required – phone/online quote" : "Optional"}
          </span>
        </div>
        {banner}
        {formOpen && !open && <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>Do a site check</Button>}
        {formOpen && open && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Check with the client before starting. Enter what you find – no prices.</p>
            {sizing.map(({ r, rec, verdict }) => {
              const st = room(r);
              return (
                <div key={key(r)} className="space-y-2 rounded-lg border p-3" data-testid="site-check-room">
                  <p className="text-sm font-semibold">{r.name}{r.unit_name ? <span className="block text-xs font-normal text-muted-foreground">{r.unit_name} · quoted {btuLabel(r.btu)}</span> : null}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label>Room floor m²<Input inputMode="decimal" className="h-11" value={st.floorM2 || ""} onChange={(e) => setRoom(r, { floorM2: num(e.target.value) || 0 })} /></label>
                    <label>Ceiling height m<Input inputMode="decimal" className="h-11" placeholder="2.6" value={st.ceilingM ?? ""} onChange={(e) => setRoom(r, { ceilingM: num(e.target.value) })} /></label>
                    <label>Open-plan extra m²<Input inputMode="decimal" className="h-11" value={st.openPlanM2 ?? ""} onChange={(e) => setRoom(r, { openPlanM2: num(e.target.value) })} /></label>
                    <label>Actual pipe length m<Input inputMode="decimal" className="h-11" placeholder={surveyPipe(r.name) != null ? `Survey ${surveyPipe(r.name)} m` : "3.5 included"} value={st.pipeM ?? ""} onChange={(e) => setRoom(r, { pipeM: num(e.target.value) })} data-testid="pipe-actual" /></label>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {([["sun", "Strong afternoon sun / big west-north glass"], ["topFloor", "Top floor / under roof"], ["kitchen", "Kitchen"], ["busy", "More than 2 people / equipment"]] as const).map(([k, l]) => (
                      <label key={k} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={!!st[k]} onChange={(e) => setRoom(r, { [k]: e.target.checked } as any)} />{l}</label>
                    ))}
                  </div>
                  {st.floorM2 > 0 && (
                    <p className={`text-sm font-semibold ${verdict === "ok" ? "text-emerald-700" : verdict === "unknown" ? "text-slate-600" : "text-red-700"}`} data-testid="size-verdict">
                      {rec.siteVisit ? `Needs a proper heat-load check (${rec.reason || "large room"})` : `Recommended ${btuLabel(rec.btu)} for ${rec.effectiveM2} m²`}
                      {verdict === "ok" ? " · Size OK" : verdict === "too_small" ? " · Quoted unit looks too small" : verdict === "too_big" ? " · Quoted unit looks too big" : ""}
                    </p>
                  )}
                  {(verdict === "too_small" || verdict === "too_big" || st.swap) && (
                    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={!!st.swap} onChange={(e) => setRoom(r, { swap: e.target.checked })} />Ask the office for a unit size change</label>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {extras.map((a) => (
                      <label key={a.code} className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-2 text-sm">
                        <span>{a.label}</span>
                        <Input inputMode="numeric" className="h-9 w-16 text-right" value={st.extras[a.code] || ""} placeholder="0"
                          onChange={(e) => setRoom(r, { extras: { ...st.extras, [a.code]: num(e.target.value) || 0 } })} aria-label={`${a.label} quantity`} />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <label>Unit positions as discussed?{sel("positions", ["Yes", "No – changed (see notes)"])}</label>
              <label>Electrical as quoted?{sel("electrical", ["Yes", "No – plug point missing", "No – isolator further than 15 m", "No – other (see notes)"])}</label>
              <label>Wall type{sel("wall", ["Brick", "Face brick", "Concrete", "Dry-wall", "Other"])}</label>
              <label>Height / access{sel("access", ["Ladder OK", "Scaffold needed", "Roof access", "Other"])}</label>
            </div>
            <label className="block text-xs">Obstacles<Input className="h-11" value={checks.obstacles} onChange={(e) => setChecks((c) => ({ ...c, obstacles: e.target.value }))} placeholder="e.g. burglar bars, cupboards, no outdoor space" /></label>
            <label className="block text-xs">Notes<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            {leadId && <SitePhotosSection leadId={leadId} />}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="h-11 flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => submit("as_quoted")} data-testid="site-check-as-quoted">
                <CheckCircle2 className="h-4 w-4" /> As quoted
              </Button>
              <Button type="button" variant="outline" className="h-11 flex-1 gap-1.5 border-orange-400 text-orange-700" disabled={busy} onClick={() => submit("variation_needed")} data-testid="site-check-variation">
                Variation needed{hasChanges ? ` (${items.length + swaps.length})` : ""}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

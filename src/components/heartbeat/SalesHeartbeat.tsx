import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useSalesHeartbeat } from "@/hooks/useSalesHeartbeat";
import { ecgPoints, fmtAge, type HbItem, type HbStage } from "@/lib/salesHeartbeat";
import { fmtRandShort } from "@/lib/quotePipeline";

/** Home heartbeat (Johan 20 Oct, mockup B): real ECG + pulse, 8 stage tiles (R4), Next step now, Then, Stalled · escalated. */
export default function SalesHeartbeat() {
  const navigate = useNavigate();
  const { hb, now, esc, canSee, loading } = useSalesHeartbeat();
  if (!canSee) return null;
  if (loading || !hb) return <div className="h-40 animate-pulse rounded-2xl bg-muted" />;
  const W = 600, H = 40;
  const pts = ecgPoints(hb.beats, { now, width: W, height: H, strength: hb.strength, flatline: hb.flatline });
  const last = hb.lastBeatAt ? `last action ${fmtAge(now - hb.lastBeatAt)} ago` : "no actions in the last 24 h";
  const escFor = (id: string) => esc.find((e) => e.entity_id === id);
  return (
    <div className="space-y-3" data-testid="sales-heartbeat">
      <section className="rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-[#CFE6F6]">Sales heartbeat · last 24 h · {fmtRandShort(hb.openValue)} open</div>
            <h2 className="text-[20px] font-semibold">{hb.flatline ? "Flatline: nothing has moved" : hb.strength < 0.7 ? "Weak pulse: items stalling" : "Heartbeat healthy"}</h2>
          </div>
          <div className="text-right" title="Sales leads in the last 7 days answered within the contact limit">
            <div className="text-[13px] text-[#CFE6F6]">Leads answered in time · 7 days</div>
            <div className="text-[25px] font-semibold">{hb.pulse.pct == null ? "–" : `${hb.pulse.pct}%`}</div>
            <div className="text-[13px] text-[#CFE6F6]">{hb.pulse.answered} of {hb.pulse.total}</div>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 h-10 w-full" aria-label={`Heartbeat: ${hb.beats.length} actions, ${last}`}>
          <polyline fill="none" stroke={hb.flatline ? "#FF8A80" : "#fff"} strokeWidth="2" points={pts} />
        </svg>
        <div className="mb-3 flex justify-between text-[13px] text-[#CFE6F6]"><span>24 h ago</span><span>{hb.beats.length} actions · {last}</span><span>now</span></div>
        {hb.flatline && <div role="alert" className="mb-3 rounded-lg bg-[#C62828] px-3 py-2 text-[13px] font-semibold">No sales actions while {hb.items.length} items wait. Pick up the next step below.</div>}
        <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-8 lg:overflow-visible">{hb.stages.map((s) => <StageTile key={s.key} s={s} items={hb.items} onClick={() => navigate(["new", "contacted", "visit"].includes(s.key) ? "/admin/dispatch" : "/admin/jobs?tab=pipeline")} />)}</div>
      </section>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border-2 border-[#1590D6] bg-[#F3FAFE] p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Next step now</h3>
          {hb.next ? (<>
            <div className="mt-1 text-[20px] font-semibold">{hb.next.title}</div>
            <div className="mb-3 text-[13px] text-muted-foreground">{hb.next.sub} · {hb.next.stalled ? `overdue ${fmtAge(hb.next.overBy)}` : `${hb.next.age} in stage`}{hb.next.value ? ` · ${fmtRandShort(hb.next.value)}` : ""}</div>
            <button onClick={() => navigate(hb.next!.next.to)} className="rounded-xl bg-[#1590D6] px-5 py-3 text-[16px] font-semibold text-white">{hb.next.next.label}</button>
          </>) : <div className="mt-1 text-[16px]">All caught up. Nothing waiting on sales.</div>}
          {hb.then.length > 0 && <><h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Then</h3>{hb.then.map((i) => <Row key={i.id} i={i} onClick={() => navigate(i.next.to)} />)}</>}
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Stalled · escalated</h3>
          {hb.stalled.length === 0 ? <div className="mt-2 text-[13px] text-muted-foreground">Nothing stalled.</div> : hb.stalled.map((i) => {
            const e = escFor(i.id);
            return <Row key={i.id} i={i} extra={e ? `Nudged ${fmtAge(now - new Date(e.created_at).getTime())} ago${e.level > 1 ? " · escalated to admin" : ""}` : "Not nudged yet"} onClick={() => navigate(i.next.to)} />;
          })}
        </section>
      </div>
    </div>
  );
}

function StageTile({ s, items, onClick }: { s: HbStage; items: HbItem[]; onClick: () => void }) {
  const worst = items.filter((i) => i.stage === s.key).reduce((m, i) => Math.max(m, i.limit ? (i.limit + i.overBy) / i.limit : 0), 0);
  const tone = s.tone === "red" ? "border-[#FF8A80] bg-[#C62828]/40" : s.tone === "amber" ? "border-[#FFCC80] bg-[#B26A00]/35" : "border-white/20 bg-white/10";
  return (
    <button onClick={onClick} className={`min-w-[116px] rounded-xl border p-2.5 text-left ${tone}`} data-stage={s.key}>
      <div className="text-[13px] text-[#CFE6F6]">{s.label}</div>
      <div className="text-[20px] font-semibold">{s.count}</div>
      <div className="text-[13px] text-[#CFE6F6]">{s.stalled ? `${s.stalled} stalled` : s.value ? fmtRandShort(s.value) : "on time"}</div>
      <div className="mt-1.5 h-1 rounded bg-white/20" title="Oldest item vs its time limit"><div className="h-1 rounded bg-white" style={{ width: `${Math.min(100, Math.round(worst * 100))}%` }} /></div>
    </button>
  );
}

function Row({ i, onClick, extra }: { i: HbItem; onClick: () => void; extra?: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 border-t py-3 text-left first-of-type:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{i.title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{extra ?? i.sub} · {i.stalled ? `overdue ${fmtAge(i.overBy)}` : i.age}</div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

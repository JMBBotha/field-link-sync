import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronRight, MapPin, Navigation, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useMyVisits } from "@/hooks/useMyVisits";
import { useSiteSurvey } from "@/hooks/useSiteSurvey";
import { mapsLink } from "@/lib/visits";
import { parseAnnotation, serializeAnnotation } from "@/lib/annotation";
import PhotoAnnotator from "@/components/photos/PhotoAnnotator";
import { Chips, PhotoSlot, Stepper, SyncBadge, Thumb } from "@/components/survey/SurveyBits";
import { HoldToRecordButton, VoiceNoteList, VoiceRecordButton } from "@/components/survey/VoiceNotes";
import type { Suggestion } from "@/lib/siteSurvey/voice";
import {
  ACCESS_FLAGS, ELECTRICAL, FLOORS, MARKER_PRESETS, ROOM_FLAGS, ROOM_NAMES, UNIT_SIZES, WALL_TYPES,
  audioOf, btuLabel, canFinish, frontPhoto, voiceFor, newRoom, overStandard, photosOf, stepPipe, surveyGaps,
  type SurveyMedia, type SurveyRoom,
} from "@/lib/siteSurvey/model";

type Step = { k: "arrive" } | { k: "rooms" } | { k: "room"; id: string } | { k: "review" };
type RoomTab = "indoor" | "outdoor" | "details";
const STEPS = [{ k: "arrive", label: "Arrive" }, { k: "rooms", label: "Rooms" }, { k: "review", label: "Review" }] as const;

/** /admin/visits/:leadId/survey — the rep's guided site survey (phone-first, works offline). No prices. */
export default function SiteSurveyPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const visits = useMyVisits(60);
  const visit = (visits.data ?? []).find((v) => v.lead_id === leadId) ?? null;
  const s = useSiteSurvey(leadId);
  const [step, setStep] = useState<Step>({ k: "arrive" });
  const [tab, setTab] = useState<RoomTab>("indoor");
  const [marking, setMarking] = useState<{ m: SurveyMedia; url: string } | null>(null);
  const [customRoom, setCustomRoom] = useState("");
  const d = s.draft;
  const gaps = useMemo(() => (d ? surveyGaps(d) : []), [d]);
  const back = () => navigate(`/admin/visits/${leadId}`);

  if (s.loading) return <p className="p-4 text-sm text-muted-foreground">Loading survey…</p>;
  if (s.error || !d) return (
    <div className="p-4 space-y-3">
      <p className="text-sm">Couldn't open the survey: {s.error ?? "unknown error"}</p>
      <Button variant="outline" className="min-h-[44px]" onClick={back}>Back to visit</Button>
    </div>
  );
  const done = d.status === "complete";
  const room = step.k === "room" ? d.rooms.find((r) => r.id === step.id) ?? null : null;
  const setRoom = (id: string, patch: Partial<SurveyRoom>) =>
    s.update((x) => ({ ...x, rooms: x.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const addRoom = (name: string) => {
    const r = newRoom(name, d.rooms.length);
    s.update((x) => ({ ...x, rooms: [...x.rooms, r] }));
    setTab("indoor"); setStep({ k: "room", id: r.id });
  };
  const removeRoom = (id: string) => {
    if (!window.confirm("Remove this room and its photos?")) return;
    s.update((x) => {
      const ids = x.media.filter((m) => m.room_id === id).map((m) => m.id);
      return { ...x, rooms: x.rooms.filter((r) => r.id !== id), media: x.media.filter((m) => m.room_id !== id),
        deletedMediaIds: [...x.deletedMediaIds, ...ids.filter((i) => x.media.find((m) => m.id === i)?.synced)],
        deletedRoomIds: [...x.deletedRoomIds, id] };
    });
    setStep({ k: "rooms" });
  };
  const photo = async (f: File, kind: "front" | "indoor" | "outdoor" | "other", roomId: string | null, replaceId?: string) => {
    try { await s.addPhoto(f, kind, roomId, replaceId); }
    catch (e: any) { toast({ title: "Couldn't save the photo", description: e?.message, variant: "destructive" }); }
  };
  const finish = () => {
    if (!canFinish(d)) { toast({ title: "Take the front-of-house photo first", variant: "destructive" }); return; }
    s.update((x) => ({ ...x, status: "complete", quote_id: x.quote_id ?? visit?.quote_id ?? null }));
    toast({ title: "Survey finished", description: s.isOnline ? "Uploading now." : "Saved on your phone. It uploads when you have signal." });
  };
  const applyTo = (roomId: string) => (x: Suggestion) => { setRoom(roomId, { [x.field]: x.value } as Partial<SurveyRoom>); toast({ title: `Set ${x.label}` }); };
  const activeIdx = step.k === "room" ? 1 : STEPS.findIndex((x) => x.k === step.k);

  return (
    <div className="v8-scope p-3 sm:p-6 space-y-3 max-w-3xl pb-40 lg:pb-6" data-testid="site-survey">
      <div className="v8-navy flex items-center justify-between gap-2">
        <Button variant="ghost" className="min-h-[44px] -ml-2" onClick={step.k === "room" ? () => setStep({ k: "rooms" }) : back}>
          <ArrowLeft className="h-4 w-4 mr-1" />{step.k === "room" ? "Rooms" : "Visit"}
        </Button>
        <SyncBadge state={s.sync} online={s.isOnline} />
      </div>
      <div>
        <div className="v8-eyebrow">Site survey{d.report_no ? ` · ${d.report_no}` : ""}</div>
        <h1 className="text-lg font-semibold">{room ? room.name : visit?.customer_name || "Client"}</h1>
      </div>
      <div className="grid grid-cols-3 gap-1" data-testid="survey-steps">
        {STEPS.map((x, i) => (
          <button key={x.k} type="button" onClick={() => setStep({ k: x.k } as Step)} className="text-left">
            <div className={cn("v8-fill my-0", i <= activeIdx && "")}><i style={{ width: i <= activeIdx ? "100%" : "0%" }} /></div>
            <span className={cn("text-xs font-semibold", i === activeIdx ? "text-primary" : "text-muted-foreground")}>{x.label}</span>
          </button>
        ))}
      </div>
      {s.syncError && <p className="text-xs text-muted-foreground">Upload will retry: {s.syncError}</p>}
      {done && step.k !== "review" && (
        <div className="rounded-xl border border-green-300 dark:border-green-400/30 bg-green-50 dark:bg-green-950/30 p-3 text-sm">This survey is finished. Changes still save and update the report.</div>
      )}

      {step.k === "arrive" && (
        <>
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold">Address</h2>
            <p className="text-sm flex items-start gap-1"><MapPin className="h-4 w-4 mt-0.5 shrink-0" />{visit?.address || "No address on this visit"}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={d.address_confirmed_at ? "default" : "outline"} className="min-h-[44px]" data-testid="survey-confirm-address"
                onClick={() => s.update((x) => ({ ...x, address_confirmed_at: x.address_confirmed_at ? null : new Date().toISOString() }))}>
                <CheckCircle2 className="h-4 w-4 mr-1" />{d.address_confirmed_at ? "Right house" : "This is the house"}
              </Button>
              {visit && mapsLink(visit) ? (
                <Button asChild variant="outline" className="min-h-[44px]"><a href={mapsLink(visit)!} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4 mr-1" />Navigate</a></Button>
              ) : <Button variant="outline" className="min-h-[44px]" disabled><Navigation className="h-4 w-4 mr-1" />No pin</Button>}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <PhotoSlot title="Front of the house" required testId="survey-front" media={frontPhoto(d)}
              onFile={(f, rep) => photo(f, "front", null, rep)} onRemove={(m) => s.removeMedia(m.id)}
              onMarkup={(m, url) => setMarking({ m, url })} />
            <p className="mt-2 text-xs text-muted-foreground">So the technician knows it's the right property.</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Access</h2>
            <div className="flex flex-wrap gap-1.5">
              {ACCESS_FLAGS.map((f) => (
                <button key={f.key} type="button" className={cn("v8-chip min-h-[36px]", d.access_flags[f.key] && "on")}
                  onClick={() => s.update((x) => ({ ...x, access_flags: { ...x.access_flags, [f.key]: !x.access_flags[f.key] } }))}>{f.label}</button>
              ))}
            </div>
            <Textarea placeholder="Access note: gate, dogs, parking, roof…" value={d.access_note ?? ""} data-testid="survey-access-note"
              onChange={(e) => s.update((x) => ({ ...x, access_note: e.target.value || null }))} />
            <VoiceRecordButton label="Access note by voice" testId="survey-access-voice"
              onDone={(b64, n) => s.addVoiceNote(b64, n, { purpose: "access", roomId: null, parentId: null })} />
            <VoiceNoteList notes={voiceFor(d, "access", null)} online={s.isOnline} onRemove={(m) => s.removeMedia(m.id)} />
          </div>
        </>
      )}

      {step.k === "rooms" && (
        <>
          {d.rooms.map((r) => {
            const n = photosOf(d, r.id).length;
            return (
              <button key={r.id} type="button" onClick={() => { setTab("indoor"); setStep({ k: "room", id: r.id }); }} data-testid="survey-room-card"
                className="block w-full text-left rounded-xl border border-border/60 bg-card p-3 min-h-[44px] active:bg-muted/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.name}{r.unit_size_btu ? ` · ${btuLabel(r.unit_size_btu)}` : ""}</div>
                    <div className="text-xs text-muted-foreground">{r.pipe_run_m ?? "–"} m pipe{r.wall_type ? ` · ${r.wall_type}` : ""}{r.electrical ? ` · ${r.electrical}` : ""} · {n} photo{n === 1 ? "" : "s"}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </button>
            );
          })}
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold">{d.rooms.length ? "Add another room" : "Add the first room"}</h2>
            <div className="flex flex-wrap gap-1.5">
              {ROOM_NAMES.map((n) => <button key={n} type="button" className="v8-chip min-h-[36px]" onClick={() => addRoom(n)} data-testid="survey-add-room">{n}</button>)}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Other room name" value={customRoom} onChange={(e) => setCustomRoom(e.target.value)} className="min-h-[44px]" />
              <Button variant="outline" className="min-h-[44px]" disabled={!customRoom.trim()} onClick={() => { addRoom(customRoom.trim()); setCustomRoom(""); }}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      {room && (
        <>
          <div className="v8-seg w-full grid grid-cols-3">
            {(["indoor", "outdoor", "details"] as RoomTab[]).map((t) => (
              <button key={t} type="button" className={cn(tab === t && "on", "capitalize")} onClick={() => setTab(t)}>
                {t}{t !== "details" && photosOf(d, room.id, t).length ? " ✓" : ""}
              </button>
            ))}
          </div>
          {tab !== "details" && (() => {
            const p = photosOf(d, room.id, tab)[0] ?? null;
            return (
              <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
                <PhotoSlot title={tab === "indoor" ? "Indoor unit position" : "Outdoor unit position"} testId={`survey-${tab}`}
                  media={p} onFile={(f, rep) => photo(f, tab, room.id, rep)} onRemove={(m) => s.removeMedia(m.id)}
                  onMarkup={(m, url) => setMarking({ m, url })} />
                {p && <>
                  <VoiceNoteList notes={audioOf(d, p.id)} online={s.isOnline} onRemove={(m) => s.removeMedia(m.id)} onApply={applyTo(room.id)} />
                  <HoldToRecordButton label="Hold to record voice note" testId="survey-photo-voice"
                    onDone={(b64, n) => s.addVoiceNote(b64, n, { purpose: "photo", roomId: room.id, parentId: p.id })} />
                </>}
              </div>
            );
          })()}
          {tab === "details" && (
            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
              <Stepper label="Pipe run" unit="m" value={room.pipe_run_m}
                hint={overStandard(room.pipe_run_m) > 0 ? `${overStandard(room.pipe_run_m)} m over the 3.5 m standard` : "Within the 3.5 m standard"}
                onStep={(dl) => setRoom(room.id, { pipe_run_m: stepPipe(room.pipe_run_m, dl * 0.5) })} />
              <Chips label="Wall" value={room.wall_type} options={WALL_TYPES.map((v) => ({ v, label: v }))} onChange={(v) => setRoom(room.id, { wall_type: v })} />
              <Chips label="Electrical" value={room.electrical} options={ELECTRICAL.map((v) => ({ v, label: v }))} onChange={(v) => setRoom(room.id, { electrical: v })} />
              <Chips label="Floor" value={room.floor_level} options={FLOORS.map((v) => ({ v, label: v }))} onChange={(v) => setRoom(room.id, { floor_level: v })} />
              <Chips label="Unit size (if known)" value={room.unit_size_btu} options={UNIT_SIZES.map((v) => ({ v, label: btuLabel(v) }))} onChange={(v) => setRoom(room.id, { unit_size_btu: v })} />
              <Stepper label="Extra core holes" value={room.core_holes ?? 0} onStep={(dl) => setRoom(room.id, { core_holes: Math.max(0, (room.core_holes ?? 0) + dl) })} />
              <div className="space-y-1.5">
                <div className="text-sm font-semibold">Also needed</div>
                <div className="flex flex-wrap gap-1.5">
                  {ROOM_FLAGS.map((f) => (
                    <button key={f.key} type="button" className={cn("v8-chip min-h-[36px]", room.flags[f.key] && "on")}
                      onClick={() => setRoom(room.id, { flags: { ...room.flags, [f.key]: !room.flags[f.key] } })}>{f.label}</button>
                  ))}
                </div>
              </div>
              <Textarea placeholder="Notes for the installer" value={room.note ?? ""} onChange={(e) => setRoom(room.id, { note: e.target.value || null })} />
              <VoiceRecordButton label="Notes by voice" testId="survey-room-voice"
                onDone={(b64, n) => s.addVoiceNote(b64, n, { purpose: "room", roomId: room.id, parentId: null })} />
              <VoiceNoteList notes={voiceFor(d, "room", room.id)} online={s.isOnline} onRemove={(m) => s.removeMedia(m.id)} onApply={applyTo(room.id)} />
            </div>
          )}
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold">More photos (DB board, roof, old unit…)</h2>
            <div className="grid grid-cols-4 gap-2">
              {photosOf(d, room.id, "other").map((m) => <Thumb key={m.id} media={m} onClick={() => { if (window.confirm("Delete this photo?")) s.removeMedia(m.id); }} />)}
              <label className="v8-dz flex aspect-square items-center justify-center rounded-md cursor-pointer">
                <Plus className="h-5 w-5" />
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) photo(f, "other", room.id); e.target.value = ""; }} />
              </label>
            </div>
          </div>
          <Button variant="ghost" className="w-full min-h-[44px] text-destructive" onClick={() => removeRoom(room.id)}><Trash2 className="h-4 w-4 mr-1" />Remove room</Button>
        </>
      )}

      {step.k === "review" && (
        <>
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2" data-testid="survey-review">
            <h2 className="text-sm font-semibold">Summary</h2>
            {d.rooms.length === 0 ? <p className="text-sm text-muted-foreground">No rooms yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase text-muted-foreground"><th className="text-left py-1 font-semibold">Room</th><th className="text-left font-semibold">Unit</th><th className="text-left font-semibold">Pipe</th><th className="text-left font-semibold">Wall</th><th className="text-left font-semibold">Power</th></tr></thead>
                <tbody>{d.rooms.map((r) => (
                  <tr key={r.id} className="border-t border-border/60"><td className="py-2 font-semibold">{r.name}</td><td>{btuLabel(r.unit_size_btu) || "–"}</td><td>{r.pipe_run_m ?? "–"} m</td><td>{r.wall_type ?? "–"}</td><td>{r.electrical ?? "–"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {gaps.length > 0 && (
            <div className="rounded-xl border border-orange-200 dark:border-orange-400/30 bg-orange-50 dark:bg-orange-950/20 p-4 space-y-1" data-testid="survey-gaps">
              <h2 className="text-sm font-semibold text-orange-800 dark:text-orange-300">Worth checking</h2>
              {gaps.map((g, i) => (
                <button key={i} type="button" className="block text-left text-sm text-orange-900 dark:text-orange-200"
                  onClick={() => (g.roomId ? setStep({ k: "room", id: g.roomId }) : setStep({ k: "arrive" }))}>• {g.text}</button>
              ))}
            </div>
          )}
          <Button className="w-full min-h-[48px]" disabled={!canFinish(d)} onClick={finish} data-testid="survey-finish">
            <CheckCircle2 className="h-4 w-4 mr-1" />{done ? `Finished${d.report_no ? ` · ${d.report_no}` : ""}` : "Finish survey"}
          </Button>
          {done && visit?.quote_id && <p className="text-xs text-muted-foreground text-center">Linked to quote {visit.quote_number ?? ""}.</p>}
        </>
      )}

      {step.k !== "review" && (
        <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background/95 p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0" data-testid="survey-actions">
          <div className="mx-auto flex max-w-3xl gap-2">
            {step.k === "arrive" && <Button className="flex-1 min-h-[48px]" onClick={() => setStep({ k: "rooms" })} data-testid="survey-next">Next: rooms <ChevronRight className="h-4 w-4 ml-1" /></Button>}
            {step.k === "rooms" && <>
              <Button variant="outline" className="flex-1 min-h-[48px]" onClick={() => setStep({ k: "arrive" })}>Back</Button>
              <Button className="flex-[2] min-h-[48px]" onClick={() => setStep({ k: "review" })} data-testid="survey-next">Next: review <ChevronRight className="h-4 w-4 ml-1" /></Button>
            </>}
            {room && <>
              <Button variant="outline" className="flex-1 min-h-[48px]" onClick={() => setStep({ k: "rooms" })}>All rooms</Button>
              <Button className="flex-[2] min-h-[48px]" data-testid="survey-next"
                onClick={() => (tab === "indoor" ? setTab("outdoor") : tab === "outdoor" ? setTab("details") : setStep({ k: "rooms" }))}>
                {tab === "details" ? "Done with room" : `Next: ${tab === "indoor" ? "outdoor" : "details"}`}<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </>}
          </div>
        </div>
      )}

      {marking && (
        <PhotoAnnotator imageUrl={marking.url} initial={parseAnnotation(marking.m.annotation)} presets={MARKER_PRESETS}
          onCancel={() => setMarking(null)}
          onSave={async (shapes, jpeg) => { await s.saveAnnotation(marking.m.id, serializeAnnotation(shapes), jpeg); setMarking(null); }} />
      )}
    </div>
  );
}

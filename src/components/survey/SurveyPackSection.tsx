import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardCheck, ChevronRight, Mic } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSurveyFileUrl } from "@/hooks/useSiteSurvey";
import { loadSurveyPack } from "@/lib/siteSurvey/pack";
import {
  ACCESS_FLAGS, ROOM_FLAGS, audioOf, btuLabel, frontPhoto, photosOf, voiceFor, type SurveyDraft, type SurveyMedia, type SurveyRoom,
} from "@/lib/siteSurvey/model";

export function useSurveyPack(leadId: string | null | undefined) {
  return useQuery({ queryKey: ["survey-pack", leadId], enabled: !!leadId, queryFn: () => loadSurveyPack(leadId!), staleTime: 60_000 });
}

function Photo({ m, label, className = "aspect-[4/3]" }: { m: SurveyMedia; label: string; className?: string }) {
  const url = useSurveyFileUrl(m.annotated_path || m.storage_path);
  return (
    <div className={`relative overflow-hidden rounded-lg bg-muted ${className}`}>
      {url && <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" />}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{label}</span>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="rounded-lg border-l-4 border-primary bg-muted/50 px-3 py-2 text-sm">
      <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-primary"><Mic className="h-3 w-3" />Rep note</span>
      {text}
    </p>
  );
}

/** Front-of-house photo for a Today card / job pack header. */
export function FrontPhoto({ survey, className }: { survey: SurveyDraft | null | undefined; className?: string }) {
  const f = survey ? frontPhoto(survey) : null;
  if (!f) return null;
  return <Photo m={f} label="Front of house" className={className} />;
}

function RoomCard({ d, r, i }: { d: SurveyDraft; r: SurveyRoom; i: number }) {
  const indoor = photosOf(d, r.id, "indoor")[0], outdoor = photosOf(d, r.id, "outdoor")[0];
  const others = photosOf(d, r.id, "other");
  const notes = [...(indoor ? audioOf(d, indoor.id) : []), ...(outdoor ? audioOf(d, outdoor.id) : []), ...voiceFor(d, "room", r.id)]
    .filter((m) => m.transcript).map((m) => m.transcript!) ;
  const flags = ROOM_FLAGS.filter((f) => r.flags?.[f.key]).map((f) => f.label);
  return (
    <Card data-testid="pack-room">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{i + 1} · {r.name}</h3>
          {r.unit_size_btu ? <Badge variant="outline">{btuLabel(r.unit_size_btu)}</Badge> : null}
        </div>
        {(indoor || outdoor) && (
          <div className="grid grid-cols-2 gap-2">
            {indoor ? <Photo m={indoor} label="Indoor" /> : <div />}
            {outdoor ? <Photo m={outdoor} label="Outdoor" /> : <div />}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {([["Pipe run", r.pipe_run_m != null ? `${r.pipe_run_m} m` : null], ["Wall", r.wall_type], ["Electrical", r.electrical],
            ["Floor", r.floor_level], ["Extra holes", r.core_holes ? String(r.core_holes) : null]] as const)
            .filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                <div className="font-semibold">{v}</div>
              </div>
            ))}
        </div>
        {flags.length > 0 && <div className="flex flex-wrap gap-1.5">{flags.map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}</div>}
        {r.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.note}</p>}
        {notes.filter((t) => !(r.note ?? "").includes(t)).map((t, k) => <Note key={k} text={t} />)}
        {others.length > 0 && <div className="grid grid-cols-3 gap-2">{others.map((m) => <Photo key={m.id} m={m} label="Photo" className="aspect-square" />)}</div>}
      </CardContent>
    </Card>
  );
}

/** Tech job pack: the rep's survey, read-only, no money. Hidden when the job has no survey. */
export default function SurveyPackSection({ leadId }: { leadId: string }) {
  const q = useSurveyPack(leadId);
  const d = q.data;
  if (!d) return null;
  const access = ACCESS_FLAGS.filter((f) => d.access_flags?.[f.key]).map((f) => f.label);
  return (
    <div className="space-y-3" data-testid="survey-pack">
      {(d.access_note || access.length > 0) && (
        <Card><CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Access</h2>
          {access.length > 0 && <div className="flex flex-wrap gap-1.5">{access.map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}</div>}
          {d.access_note && <p className="whitespace-pre-wrap text-sm">{d.access_note}</p>}
        </CardContent></Card>
      )}
      {d.rooms.length > 0 && <h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4" />Rooms from the site survey</h2>}
      {d.rooms.map((r, i) => <RoomCard key={r.id} d={d} r={r} i={i} />)}
      {d.status === "complete" && (
        <Link to={`/field/survey/${d.id}`} className="flex min-h-11 items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm font-semibold" data-testid="pack-report-link">
          <span>Full survey report{d.report_no ? ` · ${d.report_no}` : ""}</span><ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

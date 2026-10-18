/** Site Survey (rep guided flow) — pure model helpers. No prices anywhere in a survey. */
export type MediaKind = "front" | "indoor" | "outdoor" | "other" | "audio";
export type TranscriptStatus = "none" | "pending" | "done" | "failed";

export interface SurveyRoom {
  id: string; sort: number; name: string;
  unit_size_btu: number | null; pipe_run_m: number | null; wall_type: string | null;
  electrical: string | null; floor_level: string | null; core_holes: number | null;
  flags: Record<string, boolean>; note: string | null;
}
export interface SurveyMedia {
  id: string; room_id: string | null; parent_media_id: string | null; kind: MediaKind;
  storage_path: string; annotated_path: string | null; annotation: unknown | null;
  caption: string | null; transcript: string | null; transcript_status: TranscriptStatus;
  duration_s: number | null; bytes: number | null; sort: number; taken_at: string | null;
  /** local only: true once the row + files are on the server */
  synced: boolean;
  /** audio deleted after 12 months (text kept) */
  audio_purged?: boolean;
}
export interface SurveyDraft {
  id: string; leadId: string; companyId: string; createdBy: string;
  status: "draft" | "complete"; report_no: string | null; quote_id: string | null;
  access_note: string | null; access_flags: Record<string, boolean>;
  address_confirmed_at: string | null; lat: number | null; lng: number | null;
  rooms: SurveyRoom[]; media: SurveyMedia[];
  deletedRoomIds: string[]; deletedMediaIds: string[];
  /** local edit counter / last server sync */
  rev: number; syncedRev: number; updatedAt: number;
}

export const ROOM_NAMES = ["Main bedroom", "Bedroom 2", "Bedroom 3", "Lounge", "Kitchen", "Dining room", "Study", "Office", "TV room"];
export const WALL_TYPES = ["Plaster", "Face brick", "Concrete", "Drywall", "Wood / cladding"];
export const ELECTRICAL = ["Plug point", "Plug top", "Isolator from DB"];
export const FLOORS = ["Ground floor", "First floor", "Second floor +", "Roof"];
export const UNIT_SIZES = [9000, 12000, 18000, 24000, 36000];
export const ACCESS_FLAGS: { key: string; label: string }[] = [
  { key: "dogs", label: "Dogs" }, { key: "side_gate", label: "Side gate" }, { key: "intercom", label: "Ring intercom" },
  { key: "street_parking", label: "Park in street" }, { key: "ladder", label: "Ladder needed" },
  { key: "roof_access", label: "Roof / ceiling access" }, { key: "complex", label: "Complex / estate rules" },
];
export const ROOM_FLAGS: { key: string; label: string }[] = [
  { key: "ladder", label: "Ladder / height" }, { key: "ground_stand", label: "Ground stand" },
  { key: "roof_stand", label: "Roof stand" }, { key: "old_unit_removal", label: "Remove old unit" },
  { key: "condensate_pump", label: "Condensate pump" }, { key: "trunking", label: "Trunking" },
];
/** Marker labels the rep can drop on a photo (tap chip, tap photo). */
export const MARKER_PRESETS = ["IU here", "OU here", "Core drill 65 mm", "Pipe route", "Trunking route", "Drain route",
  "Isolator here", "DB board", "Bracket", "Ground stand", "Remove old unit", "Ladder needed", "Check with client"];

export const STANDARD_PIPE_M = 3.5;

export function uuid(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0; return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function newDraft(leadId: string, companyId: string, createdBy: string): SurveyDraft {
  return { id: uuid(), leadId, companyId, createdBy, status: "draft", report_no: null, quote_id: null,
    access_note: null, access_flags: {}, address_confirmed_at: null, lat: null, lng: null,
    rooms: [], media: [], deletedRoomIds: [], deletedMediaIds: [], rev: 1, syncedRev: 0, updatedAt: Date.now() };
}

export function newRoom(name: string, sort: number): SurveyRoom {
  return { id: uuid(), sort, name, unit_size_btu: null, pipe_run_m: STANDARD_PIPE_M, wall_type: null, electrical: null,
    floor_level: null, core_holes: null, flags: {}, note: null };
}

/** Storage path inside the private site-surveys bucket: {company}/{survey}/{media}.{ext} */
export function mediaPath(d: Pick<SurveyDraft, "companyId" | "id">, mediaId: string, ext: string, suffix = ""): string {
  return `${d.companyId}/${d.id}/${mediaId}${suffix}.${ext.replace(/^\./, "")}`;
}

export const photosOf = (d: SurveyDraft, roomId: string | null, kind?: MediaKind) =>
  d.media.filter((m) => m.kind !== "audio" && m.room_id === roomId && (!kind || m.kind === kind)).sort((a, b) => a.sort - b.sort);
export const audioOf = (d: SurveyDraft, parentId: string) => d.media.filter((m) => m.kind === "audio" && m.parent_media_id === parentId);
export const voiceFor = (d: SurveyDraft, purpose: "room" | "access", roomId: string | null) =>
  d.media.filter((m) => m.kind === "audio" && m.caption === purpose && m.room_id === roomId).sort((a, b) => a.sort - b.sort);
export const frontPhoto = (d: SurveyDraft) => d.media.find((m) => m.kind === "front") ?? null;

export interface Gap { roomId: string | null; text: string; blocking: boolean }
/** Review gaps. Only the front photo is required; everything else is a soft (amber) reminder. */
export function surveyGaps(d: SurveyDraft): Gap[] {
  const g: Gap[] = [];
  if (!frontPhoto(d)) g.push({ roomId: null, text: "Front-of-house photo (required)", blocking: true });
  if (!d.address_confirmed_at) g.push({ roomId: null, text: "Address not confirmed", blocking: false });
  if (!d.rooms.length) g.push({ roomId: null, text: "No rooms added", blocking: false });
  for (const r of d.rooms) {
    if (!photosOf(d, r.id, "indoor").length) g.push({ roomId: r.id, text: `${r.name}: no indoor photo`, blocking: false });
    if (!photosOf(d, r.id, "outdoor").length) g.push({ roomId: r.id, text: `${r.name}: no outdoor photo`, blocking: false });
    if (r.pipe_run_m == null) g.push({ roomId: r.id, text: `${r.name}: pipe run not set`, blocking: false });
    if (!r.electrical) g.push({ roomId: r.id, text: `${r.name}: electrical not set`, blocking: false });
  }
  return g;
}
export const canFinish = (d: SurveyDraft) => !surveyGaps(d).some((x) => x.blocking);

export const overStandard = (m: number | null) => (m == null ? 0 : Math.max(0, Math.round((m - STANDARD_PIPE_M) * 10) / 10));
export const btuLabel = (b: number | null) => (b ? `${Math.round(b / 1000)}K` : "");
export const stepPipe = (m: number | null, delta: number) => Math.min(60, Math.max(0, Math.round(((m ?? STANDARD_PIPE_M) + delta) * 2) / 2));

/** Server rows -> draft (used when no local draft exists). */
export function draftFromServer(s: any, rooms: any[], media: any[]): SurveyDraft {
  return {
    id: s.id, leadId: s.lead_id, companyId: s.company_id, createdBy: s.created_by, status: s.status,
    report_no: s.report_no ?? null, quote_id: s.quote_id ?? null, access_note: s.access_note ?? null,
    access_flags: s.access_flags ?? {}, address_confirmed_at: s.address_confirmed_at ?? null,
    lat: s.lat ?? null, lng: s.lng ?? null,
    rooms: rooms.map((r) => ({ id: r.id, sort: r.sort ?? 0, name: r.name, unit_size_btu: r.unit_size_btu ?? null,
      pipe_run_m: r.pipe_run_m == null ? null : Number(r.pipe_run_m), wall_type: r.wall_type ?? null, electrical: r.electrical ?? null,
      floor_level: r.floor_level ?? null, core_holes: r.core_holes ?? null, flags: r.flags ?? {}, note: r.note ?? null }))
      .sort((a, b) => a.sort - b.sort),
    media: media.filter((m) => !m.archived_at).map((m) => ({ id: m.id, room_id: m.room_id ?? null, parent_media_id: m.parent_media_id ?? null,
      kind: m.kind, storage_path: m.storage_path, annotated_path: m.annotated_path ?? null, annotation: m.annotation ?? null,
      caption: m.caption ?? null, transcript: m.transcript ?? null, transcript_status: m.transcript_status ?? "none",
      duration_s: m.duration_s == null ? null : Number(m.duration_s), bytes: m.bytes ?? null, sort: m.sort ?? 0,
      taken_at: m.taken_at ?? null, synced: true, audio_purged: !!m.audio_purged_at })),
    deletedRoomIds: [], deletedMediaIds: [], rev: 1, syncedRev: 1, updatedAt: Date.now(),
  };
}

export function surveyRow(d: SurveyDraft) {
  return { id: d.id, lead_id: d.leadId, created_by: d.createdBy, status: d.status, quote_id: d.quote_id,
    access_note: d.access_note, access_flags: d.access_flags, address_confirmed_at: d.address_confirmed_at, lat: d.lat, lng: d.lng };
}
export function roomRow(d: SurveyDraft, r: SurveyRoom) {
  const { id, sort, name, unit_size_btu, pipe_run_m, wall_type, electrical, floor_level, core_holes, flags, note } = r;
  return { id, survey_id: d.id, sort, name, unit_size_btu, pipe_run_m, wall_type, electrical, floor_level, core_holes, flags, note };
}
export function mediaRow(d: SurveyDraft, m: SurveyMedia) {
  const { id, room_id, parent_media_id, kind, storage_path, annotated_path, annotation, caption, transcript, transcript_status, duration_s, bytes, sort, taken_at } = m;
  return { id, survey_id: d.id, room_id, parent_media_id, kind, storage_path, annotated_path, annotation, caption, transcript,
    transcript_status, duration_s, bytes, sort, taken_at };
}

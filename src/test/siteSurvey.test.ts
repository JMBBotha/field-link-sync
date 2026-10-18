import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canFinish, draftFromServer, mediaPath, mediaRow, newDraft, newRoom, overStandard, roomRow, stepPipe, surveyGaps, surveyRow,
} from "@/lib/siteSurvey/model";

const CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const media = (over: any) => ({ id: "m1", room_id: null, parent_media_id: null, kind: "front", storage_path: "x", annotated_path: null,
  annotation: null, caption: null, transcript: null, transcript_status: "none", duration_s: null, bytes: 1, sort: 0, taken_at: null, synced: false, ...over });

describe("site survey model", () => {
  it("paths are {company}/{survey}/{file} in the private bucket", () => {
    const d = newDraft("lead", CO, "me");
    expect(mediaPath(d, "m1", "jpg")).toBe(`${CO}/${d.id}/m1.jpg`);
    expect(mediaPath(d, "m1", ".wav", "-a")).toBe(`${CO}/${d.id}/m1-a.wav`);
  });
  it("only the front photo blocks finishing", () => {
    const d = newDraft("lead", CO, "me");
    expect(canFinish(d)).toBe(false);
    d.media.push(media({}) as any);
    expect(canFinish(d)).toBe(true);
    d.rooms.push(newRoom("Lounge", 0));
    const g = surveyGaps(d);
    expect(g.some((x) => x.text.includes("Lounge: no indoor photo") && !x.blocking)).toBe(true);
    expect(canFinish(d)).toBe(true);
  });
  it("pipe stepper and over-standard", () => {
    expect(stepPipe(3.5, 0.5)).toBe(4);
    expect(stepPipe(0, -0.5)).toBe(0);
    expect(overStandard(6)).toBe(2.5);
    expect(overStandard(3)).toBe(0);
  });
  it("rows sent to the server carry no company_id and no money fields", () => {
    const d = newDraft("lead", CO, "me");
    const r = newRoom("Lounge", 0);
    const all = { ...surveyRow(d), ...roomRow(d, r), ...mediaRow(d, media({}) as any) };
    expect(Object.keys(all)).not.toContain("company_id");
    expect(Object.keys(all).join(",")).not.toMatch(/price|cost|total|sell|markup/);
  });
  it("server rows round-trip into a synced draft", () => {
    const d = draftFromServer({ id: "s", lead_id: "l", company_id: CO, created_by: "u", status: "complete", report_no: "SS-2026-001" },
      [{ id: "r", name: "Lounge", sort: 0, pipe_run_m: "6.0" }], [{ id: "m", kind: "indoor", room_id: "r", storage_path: "p" }]);
    expect(d.rooms[0].pipe_run_m).toBe(6);
    expect(d.media[0].synced).toBe(true);
    expect(d.rev).toBe(d.syncedRev);
  });
  it("uses the private site-surveys bucket only (never quote-photos)", () => {
    const src = readFileSync("src/lib/siteSurvey/sync.ts", "utf8") + readFileSync("src/hooks/useSiteSurvey.ts", "utf8");
    expect(src).toContain('"site-surveys"');
    expect(src).not.toContain("quote-photos");
    expect(src).not.toContain("getPublicUrl");
  });
  it("migration keeps the bucket private and has no anon/public storage policy", () => {
    const sql = readFileSync("supabase/migrations/20261018230000_site_surveys.sql", "utf8");
    expect(sql).toMatch(/'site-surveys', 'site-surveys', false/);
    expect(sql).not.toMatch(/TO (anon|public)/i);
  });
  it("visit detail links to the survey", () => {
    expect(readFileSync("src/pages/admin/AdminVisitsPage.tsx", "utf8")).toContain("<SurveyEntryCard leadId={r.lead_id} />");
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="visits/:leadId/survey"');
  });
});

import { suggestFromTranscript, wavSeconds } from "@/lib/siteSurvey/voice";
describe("voice note suggestions", () => {
  it("reads metres, wall and electrical from plain speech", () => {
    const s = suggestFromTranscript("Pipe goes along the cornice, about six and a half metres to the back corner. Face brick outside, plug top.");
    expect(s.find((x) => x.field === "pipe_run_m")?.value).toBe(6.5);
    expect(s.find((x) => x.field === "wall_type")?.value).toBe("Face brick");
    expect(s.find((x) => x.field === "electrical")?.value).toBe("Plug top");
  });
  it("handles digits from formatted transcripts and unit sizes", () => {
    const s = suggestFromTranscript("12K in the main bedroom, 4 m run, isolator from the DB");
    expect(s.find((x) => x.field === "pipe_run_m")?.value).toBe(4);
    expect(s.find((x) => x.field === "unit_size_btu")?.value).toBe(12000);
    expect(s.find((x) => x.field === "electrical")?.value).toBe("Isolator from DB");
  });
  it("suggests nothing from unrelated speech", () => {
    expect(suggestFromTranscript("Client wants it quiet at night")).toEqual([]);
  });
  it("wav duration from bytes", () => { expect(wavSeconds(44 + 32000 * 3)).toBe(3); });
  it("STT model pinned in voice-quote-parse", () => {
    expect(readFileSync("supabase/functions/voice-quote-parse/index.ts", "utf8")).toContain('form.append("model", "grok-voice-transcribe-2.0")');
  });
});

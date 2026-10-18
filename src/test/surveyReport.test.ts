import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { buildSurveyReportPdf } from "@/lib/siteSurvey/reportPdf";
import { areasFromSurvey, roomLine } from "@/lib/siteSurvey/quoteFromSurvey";
import { surveyRequired, SURVEY_REQUIRED_FROM } from "@/lib/siteSurvey/dispatchGuard";
import { siteCheckHints } from "@/lib/siteSurvey/pack";
import { newDraft, newRoom } from "@/lib/siteSurvey/model";

const read = (p: string) => readFileSync(p, "utf8");
const draft = () => {
  const d = newDraft("lead-1", "co-1", "u-1");
  const a = { ...newRoom("Main bedroom", 0), unit_size_btu: 12000, pipe_run_m: 3.5, wall_type: "Face brick", electrical: "Plug point" };
  const b = { ...newRoom("Lounge", 1), unit_size_btu: 18000, pipe_run_m: 6, wall_type: "Face brick", electrical: "Isolator from DB", core_holes: 1, flags: { ladder: true } };
  return { ...d, status: "complete" as const, report_no: "SS-2026-001", rooms: [a, b] };
};

describe("Survey report + quote from survey + dispatch guard (P5/P6)", () => {
  it("PDF builds, carries the SS number, no prices, no phone numbers", async () => {
    const bytes = await buildSurveyReportPdf({ survey: draft(), client: { name: "Client – test" }, image: async () => null });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getTitle()).toContain("SS-2026-001");
    const src = read("src/lib/siteSurvey/reportPdf.ts");
    expect(src).not.toMatch(/unit_price|total_price|0800 232 665|\bt\/a\b/i);
  });
  it("one line per room, no money", () => {
    const areas = areasFromSurvey(draft());
    expect(areas).toHaveLength(2);
    expect(areas[1].name).toBe("Lounge");
    expect(areas[1].description).toBe("18K BTU · 6 m pipe (2.5 m over standard) · Face brick · Isolator from DB · 1 extra hole · Ladder / height");
    expect(areas.every((a) => !String(a.description).includes("\n"))).toBe(true);
    expect(read("src/lib/siteSurvey/quoteFromSurvey.ts")).not.toMatch(/quote_items|unit_price/);
    expect(roomLine({ ...newRoom("X", 0), pipe_run_m: null })).toBe("");
  });
  it("dispatch guard: only new site-visited installs without a finished survey", () => {
    const after = "2026-10-20T08:00:00+02:00", before = "2026-10-01T08:00:00+02:00";
    expect(surveyRequired({ has_install: true, remote_quote: false, quote_created_at: after, survey_status: null })).toBe(true);
    expect(surveyRequired({ has_install: true, remote_quote: false, quote_created_at: after, survey_status: "draft" })).toBe(true);
    expect(surveyRequired({ has_install: true, remote_quote: false, quote_created_at: after, survey_status: "complete" })).toBe(false);
    expect(surveyRequired({ has_install: true, remote_quote: true, quote_created_at: after, survey_status: null })).toBe(false);
    expect(surveyRequired({ has_install: false, remote_quote: false, quote_created_at: after, survey_status: null })).toBe(false);
    expect(surveyRequired({ has_install: true, remote_quote: false, quote_created_at: before, survey_status: null })).toBe(false);
    expect(SURVEY_REQUIRED_FROM).toMatch(/\+02:00$/);
    expect(read("src/components/jobs/AssignTechDialog.tsx")).toMatch(/surveyDispatchBlock\(jobId\)/);
  });
  it("site check hints: wall only when all rooms agree and it maps; pipe by room", () => {
    expect(siteCheckHints(draft())).toEqual({ wall: "Face brick", pipeByRoom: { "main bedroom": 3.5, lounge: 6 } });
    const d = draft(); d.rooms[0].wall_type = "Plaster";
    expect(siteCheckHints(d)?.wall).toBeNull();
    expect(siteCheckHints(null)).toBeNull();
  });
  it("report routes are staff + tech only; chip on the builder, not on the client view", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/visits\/:leadId\/survey\/report" element={<RequireRole allowedRoles={\["admin", "dispatcher"\]}>/);
    expect(app).toMatch(/\/field\/survey\/:leadId" element={<V8FieldShell><RequireRole allowedRoles={\["field_agent", "admin", "dispatcher"\]}>/);
    expect(read("src/components/quoting/EstimateBuilder.tsx")).toMatch(/<SurveyReportChip/);
    expect(read("src/components/client/ClientProposalView.tsx")).not.toMatch(/SurveyReport|site_surveys/);
  });
});

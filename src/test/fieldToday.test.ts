import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { v8Primary, v8More } from "@/components/v8/v8Nav";
import { JOB_SHEET_SELECT } from "@/lib/jobPack";
import { pipeSummary } from "@/lib/siteSurvey/pack";

const read = (p: string) => readFileSync(p, "utf8");

describe("Field Today + job pack (P1)", () => {
  it("tech tab bar is Today / Schedule / Earnings; job offers + old field home one tap from More", () => {
    expect(v8Primary("tech").map((l) => l.label)).toEqual(["Today", "Schedule", "Earnings"]);
    const more = v8More("tech").flatMap((g) => g.links.map((l) => l.path));
    expect(more).toContain("/admin/my-jobs");
    expect(more).toContain("/field/all");
  });
  it("/field picks Today only for pure techs without deep links; /field/all keeps the old home", () => {
    const home = read("src/pages/FieldHome.tsx");
    expect(home).toMatch(/isFieldAgent && !isAdmin && !isDispatcher && !deep/);
    const app = read("src/App.tsx");
    expect(app).toMatch(/path="\/field" element={<SalesRepFieldRedirect><V8FieldShell><FieldHome \/>/);
    expect(app).toMatch(/path="\/field\/all" element={<SalesRepFieldRedirect><V8FieldShell><FieldAgent \/>/);
  });
  it("job pack reads no money", () => {
    expect(JOB_SHEET_SELECT).not.toMatch(/price|total|amount|cost|margin|commission/i);
    for (const f of ["src/pages/FieldTodayPage.tsx", "src/components/survey/SurveyPackSection.tsx", "src/lib/siteSurvey/pack.ts"]) {
      expect(read(f)).not.toMatch(/unit_price|total_amount|\bR\s?\d|cost_price|margin/i);
    }
  });
  it("job sheet keeps the R2 site check gate", () => {
    const s = read("src/pages/FieldJobSheetPage.tsx");
    expect(s).toMatch(/siteCheckBlock\(site\.data\)/);
    expect(s).toMatch(/disabled={busy \|\| !!blocked}/);
    expect(s).toMatch(/<SurveyPackSection leadId=/);
  });
  it("pipe summary", () => {
    expect(pipeSummary(null)).toEqual([]);
    expect(pipeSummary({ rooms: [{ name: "Lounge", pipe_run_m: 6 }] } as any)).toEqual([{ name: "Lounge", m: 6 }]);
  });
});

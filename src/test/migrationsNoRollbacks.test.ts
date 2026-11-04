import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Guard (Johan 4 Nov 2026): undo/rollback scripts must never sit in supabase/migrations,
// because that folder is applied in order and they would undo the change straight after it.
// Keep them in supabase/manual/ with the header "MANUAL ROLLBACK - DO NOT RUN AS MIGRATION".
const DIR = "supabase/migrations";
const NAME_RE = /(rollback|undo|revert)/i;
// First line of the file. Older migrations document their undo as "-- Rollback: ..." (a comment
// that points elsewhere), which is fine; a header that says the file IS a rollback is not.
const HEADER_RE = /^--\s*(manual\s+rollback|rollback\s+for|undo\s+for|undo\s+script|rollback\s+script|restores?\b)/i;

describe("supabase/migrations holds no rollback/undo scripts", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  it("no file name says rollback/undo", () => {
    expect(files.filter((f) => NAME_RE.test(f))).toEqual([]);
  });
  it("no file header says it is a rollback/undo", () => {
    const bad = files.filter((f) => {
      const first = readFileSync(join(DIR, f), "utf8").split("\n").find((l) => l.trim() !== "") ?? "";
      return HEADER_RE.test(first.trim()) || /DO NOT RUN AS MIGRATION/i.test(first);
    });
    expect(bad).toEqual([]);
  });
  it("manual rollbacks carry the warning header", () => {
    const manual = readdirSync("supabase/manual").filter((f) => NAME_RE.test(f) && f.endsWith(".sql") && /^\d{14}_/.test(f));
    for (const f of manual) {
      expect(readFileSync(join("supabase/manual", f), "utf8").split("\n")[0]).toBe("-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION");
    }
  });
});

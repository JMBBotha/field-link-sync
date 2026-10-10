import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("Quote line options button (Johan 21:29)", () => {
  it("hamburger 44px 'Line options' button with labelled Move to / Duplicate to menu; same show rule", () => {
    const e = readFileSync("src/components/quoting/EstimateDocument.tsx", "utf8");
    expect(e).not.toContain("MoreHorizontal");
    expect(e).toMatch(/aria-label="Line options"[\s\S]{0,300}h-11 w-11[\s\S]{0,200}<Menu className/);
    expect(e).toMatch(/<ArrowRightLeft className="h-4 w-4" \/>Move to…/);
    expect(e).toMatch(/<Copy className="h-4 w-4" \/>Duplicate to…/);
    expect(e).toContain("(editing.onMoveLine || editing.onDuplicateLine) && editing.areas.some((a) => a.id && a.id !== area.id)");
  });
});

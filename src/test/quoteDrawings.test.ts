import { describe, expect, it } from "vitest";
import { parseDrawingName, drawingPath } from "@/lib/drawings/quoteDrawings";

describe("quote drawing names", () => {
  it("parses drawings and BOQ", () => {
    expect(parseDrawingName("Q-2026-0047_G1_mechanical_RevD.pdf")).toMatchObject({ quoteNumber: "Q-2026-0047", area: "G1", revision: "RevD", kind: "pdf" });
    expect(parseDrawingName("Q-2026-0047_G1_BOQ_RevD.csv")).toMatchObject({ kind: "boq_csv" });
    expect(parseDrawingName("Q-2026-0047_G1_layout_RevB.png")).toMatchObject({ kind: "png" });
  });
  it("rejects bad names", () => {
    expect(parseDrawingName("Smith house layout.pdf")).toBeNull();
    expect(parseDrawingName("Q-2026-0047_G1_mechanical.pdf")).toBeNull();
    expect(parseDrawingName("Q-2026-0047_G1_notes_RevD.csv")).toBeNull();
  });
  it("paths carry only company and quote ids", () => {
    const p = drawingPath("c0000000-0000-0000-0000-000000000000", "a0000000-0000-0000-0000-000000000000", "pdf");
    expect(p).toMatch(/^c0{7}-[0-9-]+\/a0{7}-[0-9-]+\/[0-9a-f-]{36}\.pdf$/);
  });
});

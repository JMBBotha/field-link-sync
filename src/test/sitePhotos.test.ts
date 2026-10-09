import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseAnnotation, serializeAnnotation, type AnnShape } from "@/lib/annotation";
import { photoDisplayPath } from "@/lib/photoUrls";

describe("P2 annotation JSON", () => {
  it("round-trips pen, arrow and text", () => {
    const shapes: AnnShape[] = [
      { t: "pen", c: "#ef4444", pts: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
      { t: "arrow", c: "#facc15", a: { x: 0.5, y: 0.5 }, b: { x: 0.9, y: 0.1 } },
      { t: "text", c: "#ffffff", at: { x: 0.2, y: 0.8 }, text: "Unit here" },
    ];
    const json = JSON.parse(JSON.stringify(serializeAnnotation(shapes)));
    expect(parseAnnotation(json)).toEqual(shapes);
  });
  it("drops junk and clamps coordinates/colours", () => {
    const out = parseAnnotation({ v: 1, shapes: [{ t: "pen", c: "#000", pts: [{ x: 2, y: -1 }] }, { t: "text", c: "#fff", at: { x: 0, y: 0 }, text: " " }, { t: "x" }] });
    expect(out).toEqual([{ t: "pen", c: "#ef4444", pts: [{ x: 1, y: 0 }] }]);
    expect(parseAnnotation(null)).toEqual([]);
  });
});

describe("P2 galleries", () => {
  it("prefer the annotated copy", () => {
    expect(photoDisplayPath({ storage_path: "a/1.jpg", annotated_path: "a/1-annotated.jpg" })).toBe("a/1-annotated.jpg");
    expect(photoDisplayPath({ storage_path: "a/1.jpg", annotated_path: null })).toBe("a/1.jpg");
  });
  it("use signed URLs on the private bucket (no getPublicUrl)", () => {
    for (const f of ["src/components/PhotoGallery.tsx", "src/components/ExpandedPhotoGallery.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toContain("getPublicUrl");
      expect(s).toContain("signedPhotoUrl(photoDisplayPath(");
    }
    expect(readFileSync("src/lib/photoUrls.ts", "utf8")).toContain('from("job-photos").createSignedUrl');
  });
  it("site photos: rep visit editable, tech job sheet read-only, never the public bucket", () => {
    expect(readFileSync("src/pages/admin/AdminVisitsPage.tsx", "utf8")).toContain("<SitePhotosSection leadId={r.lead_id} />");
    expect(readFileSync("src/pages/FieldJobSheetPage.tsx", "utf8")).toContain("<SitePhotosReadOnly leadId={job.data.lead_id} />");
    const sec = readFileSync("src/components/photos/SitePhotosSection.tsx", "utf8");
    expect(sec).not.toContain("quote-photos");
    expect(sec).toContain('uploadPhoto(f, "site")');
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { quotePhotoPath, quotePhotoRef } from "@/lib/quotePhotos";

describe("quote-photos is private", () => {
  it("no app code calls getPublicUrl on quote-photos", () => {
    const hits = execSync("grep -rln 'quote-photos' src supabase/functions || true").toString().split("\n").filter(Boolean);
    for (const f of hits) {
      const s = readFileSync(f, "utf8");
      expect(s.match(/from\(["']quote-photos["']\)\s*\.getPublicUrl/), f).toBeNull();
    }
  });
  it("uploads use a company-id prefix", () => {
    for (const f of ["src/components/quoting/PhotoUploader.tsx", "src/components/quoting/VisualSectionEditor.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain("${companyId}/");
    }
  });
  it("resolves refs and legacy public URLs to paths", () => {
    expect(quotePhotoPath(quotePhotoRef("c/q/a.jpg"))).toBe("c/q/a.jpg");
    expect(quotePhotoPath("https://x.supabase.co/storage/v1/object/public/quote-photos/c/s/a%20b.jpg")).toBe("c/s/a b.jpg");
    expect(quotePhotoPath("https://example.com/a.jpg")).toBeNull();
  });
});

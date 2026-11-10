import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { V8_HEADER_LOGO_CLASS, V8_HEADER_ROW_CLASS } from "@/components/shared/v8HeaderLogo";

const src = (p: string) => readFileSync(p, "utf8");

describe("V8 top bar company logo", () => {
  it("shows a large object-contain mark at every width, including desktop", () => {
    expect(V8_HEADER_LOGO_CLASS).toContain("object-contain");
    expect(V8_HEADER_LOGO_CLASS).not.toContain("object-cover");
    expect(V8_HEADER_LOGO_CLASS).not.toContain("lg:hidden");
    expect(V8_HEADER_LOGO_CLASS).toContain("h-16");
    expect(V8_HEADER_LOGO_CLASS).not.toMatch(/\bh-9\b/);
    expect(V8_HEADER_ROW_CLASS).toContain("h-[4.5rem]");

    const header = src("src/components/admin/NewAdminHeader.tsx");
    expect(header).toContain('data-testid="header-logo"');
    expect(header).toContain("V8_HEADER_LOGO_CLASS");
    expect(header).not.toMatch(/header-logo" className="[^"]*lg:hidden/);

    const shell = src("src/components/v8/V8FieldShell.tsx");
    expect(shell).toContain('data-testid="header-logo"');
    expect(shell).toContain("V8_HEADER_LOGO_CLASS");
    expect(shell).toContain('data-testid="v8-field-top-bar"');
    expect(shell.indexOf("v8-field-top-bar")).toBeLessThan(shell.indexOf("<V8Sidebar"));

    const css = src("src/components/v8/v8.css");
    expect(css).toContain("--v8-top:#3D9BEB");
    expect(css).toContain(".v8-richer-halo .v8-logo-light");
    expect(css).toContain("display: none !important");
  });
});

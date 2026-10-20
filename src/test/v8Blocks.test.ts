import { describe, it, expect } from "vitest";
import { V8_TONE, V8_HEADER_CLASS } from "@/components/v8/ui/V8Blocks";
describe("V8 blocks", () => {
  it("every chip tone has a dark variant", () => { for (const v of Object.values(V8_TONE)) expect(v).toMatch(/dark:bg-/); });
  it("header uses the navy gradient", () => { expect(V8_HEADER_CLASS).toContain("from-[#0F2A44]"); });
});

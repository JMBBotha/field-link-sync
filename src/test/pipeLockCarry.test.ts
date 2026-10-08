import { describe, it, expect } from "vitest";
import { buildManualIndex, resolvePipeCols, normPipeCode } from "@/lib/pipeLockCarry";

describe("pipe-size lock carries across re-import", () => {
  it("normalises codes", () => expect(normPipeCode(" AR40F24C0AG~hist-x ")).toBe("ar40f24c0ag"));
  it("archived manual row wins over imported text", () => {
    const idx = buildManualIndex([
      { id: "old", product_code: "AR40F24C0AG~hist-x", pipe_size: "1/4 1/2", pipe_liquid: "1/4", pipe_gas: "1/2" },
    ]);
    const r = resolvePipeCols(idx, "ar40f24c0ag", "3/8 x 5/8");
    expect(r.pipe_liquid).toBe("1/4");
    expect(r.pipe_gas).toBe("1/2");
    expect(r.pipe_sizes_manual).toBe(true);
  });
  it("no manual row → parse text, not locked", () => {
    const r = resolvePipeCols(buildManualIndex([]), "X1", "3/8 x 5/8");
    expect([r.pipe_liquid, r.pipe_gas, r.pipe_sizes_manual]).toEqual(["3/8", "5/8", undefined]);
  });
  it("brand scoped", () => {
    const idx = buildManualIndex([{ product_code: "X1", brand: "LG", pipe_liquid: "1/4", pipe_gas: "1/2" }]);
    expect(resolvePipeCols(idx, "x1", "3/8 5/8", "Samsung").pipe_sizes_manual).toBeUndefined();
  });
});

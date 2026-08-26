import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const eq = vi.fn();
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, rpc },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { createQuoteVersionSnapshot } from "@/hooks/useQuoteVersions";

describe("quote version snapshots", () => {
  beforeEach(() => {
    from.mockClear();
    select.mockClear();
    eq.mockReset();
    rpc.mockReset();
  });

  it("refuses to create an empty version", async () => {
    eq.mockResolvedValue({ count: 0, error: null });

    await expect(createQuoteVersionSnapshot("quote-1")).rejects.toThrow(
      "Add at least one line item before creating a quote version.",
    );

    expect(from).toHaveBeenCalledWith("quote_items");
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(eq).toHaveBeenCalledWith("quote_id", "quote-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a version only after confirming live builder items exist", async () => {
    eq.mockResolvedValue({ count: 2, error: null });
    rpc.mockResolvedValue({ data: "version-1", error: null });

    await expect(createQuoteVersionSnapshot("quote-1")).resolves.toBe("version-1");
    expect(rpc).toHaveBeenCalledWith("create_quote_version", { p_quote_id: "quote-1" });
  });

  it("returns the database error when snapshot creation fails", async () => {
    eq.mockResolvedValue({ count: 1, error: null });
    rpc.mockResolvedValue({ data: null, error: new Error("Snapshot copy failed") });

    await expect(createQuoteVersionSnapshot("quote-1")).rejects.toThrow("Snapshot copy failed");
  });
});
import { describe, expect, it } from "vitest";
import { amountLabel, groupSteps, shortQuoteNo, urgency, type NextStep, type QuoteMeta } from "@/lib/nextSteps";

const row = (id: string, since: string, amount: number, extra: Partial<NextStep> = {}): NextStep => ({
  rule: "followup", prio: 3, entity_type: "quote", entity_id: id, title: "Demo Client A", detail: `Q-2026-00${id} · sent`, amount, since, owner_id: "u", link: "", snoozable: true, ...extra,
});
const m = (id: string, g: string | null): QuoteMeta => ({ id, option_group_id: g, quote_number: `Q-2026-00${id}`, total: 0, sent_at: null });
const fmt = (n: number | null) => (n == null ? "" : `R ${n}`);

describe("quote option groups in Next steps", () => {
  it("merges options of one group into one card, oldest drives urgency", () => {
    const rows = [row("42", "2026-10-30T08:00:00Z", 446465), row("41", "2026-10-20T08:00:00Z", 819100), row("50", "2026-10-31T08:00:00Z", 10)];
    const out = groupSteps(rows, { "41": m("41", "g"), "42": m("42", "g"), "50": m("50", null) });
    expect(out).toHaveLength(2);
    const g = out.find((r) => r.options)!;
    expect(g.detail).toBe("2 options · Q-0041, Q-0042");
    expect(g.entity_id).toBe("41");
    expect(g.since).toBe("2026-10-20T08:00:00Z");
    expect(urgency(g, Date.parse("2026-11-01T08:00:00Z"))).toBe("red");
    expect(amountLabel(g, fmt)).toBe("R 446465 – R 819100");
  });
  it("a lone grouped quote stays a normal card; different rules never merge", () => {
    const out = groupSteps([row("41", "2026-10-20T08:00:00Z", 1), row("42", "2026-10-20T08:00:00Z", 2, { rule: "cold" })], { "41": m("41", "g"), "42": m("42", "g") });
    expect(out.every((r) => !r.options)).toBe(true);
    expect(out).toHaveLength(2);
  });
  it("short quote numbers", () => { expect(shortQuoteNo("Q-2026-0041")).toBe("Q-0041"); });
});

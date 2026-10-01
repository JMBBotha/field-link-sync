import { describe, it, expect } from "vitest";
import { buildDeals, stageOf, columnSummary, followUps, pipelineChips, dropAction, matchesChip, fmtRandShort } from "./quotePipeline";

const now = new Date("2026-10-01T12:00:00+02:00");
const q = (o: any) => ({ id: o.id, status: "draft", total: 1000, created_at: "2026-09-28T08:00:00Z", ...o });

describe("quotePipeline", () => {
  it("derives stages from status + jobs", () => {
    expect(stageOf(q({ id: "a" }), [])).toBe("draft");
    expect(stageOf(q({ id: "a", status: "sent" }), [])).toBe("sent");
    expect(stageOf(q({ id: "a", status: "viewed" }), [])).toBe("viewed");
    expect(stageOf(q({ id: "a", status: "accepted" }), [])).toBe("accepted");
    expect(stageOf(q({ id: "a", status: "accepted" }), [{ quote_id: "a", status: "scheduled" }])).toBe("booked");
    expect(stageOf(q({ id: "a", status: "accepted" }), [{ quote_id: "a", status: "cancelled" }])).toBe("accepted");
    expect(stageOf(q({ id: "a", status: "declined" }), [])).toBe("lost");
    expect(stageOf(q({ id: "a", status: "superseded" }), [])).toBeNull();
  });

  it("flags paid-no-job, job cancelled, expired, stale, no view and R0", () => {
    const deals = buildDeals(
      [
        q({ id: "p", status: "accepted", total: 20879, accepted_at: "2026-07-30T08:00:00Z" }),
        q({ id: "c", status: "accepted", total: 0, accepted_at: "2026-09-03T08:00:00Z" }),
        q({ id: "e", status: "sent", total: 144319, sent_at: "2026-07-05T08:00:00Z", valid_until: "2026-08-04" }),
        q({ id: "s", status: "viewed", total: 7360, sent_at: "2026-09-11T08:00:00Z", viewed_at: "2026-09-11T09:00:00Z", valid_until: "2026-10-10" }),
        q({ id: "d", status: "accepted", total: 5000, accepted_at: "2026-09-30T08:00:00Z" }),
      ],
      [
        { quote_id: "p", status: "paid", grand_total: 20879 },
        { quote_id: "c", status: "paid", notes: "DEPOSIT — 50%", grand_total: 7839 },
        { quote_id: "d", status: "sent", notes: "DEPOSIT — 50%", grand_total: 2500 },
      ],
      [{ quote_id: "c", status: "cancelled" }],
      now,
    );
    const by = Object.fromEntries(deals.map((d) => [d.quote.id, d]));
    expect(by.p.flags).toEqual(["paid_no_job"]);
    expect(by.p.paid).toBe(20879);
    expect(by.c.flags).toEqual(["job_cancelled", "zero"]);
    expect(by.e.flags).toEqual(["expired", "no_view"]);
    expect(by.s.flags).toEqual(["stale"]);
    expect(by.s.days).toBe(20);
    expect(by.d.depositDue).toBe(true);
    expect(by.d.flags).toEqual([]);
  });

  it("summarises columns and ranks follow-ups by value x days", () => {
    const deals = buildDeals([
      q({ id: "a", total: 100000, created_at: "2026-09-30T08:00:00Z" }),
      q({ id: "b", total: 50000, created_at: "2026-09-01T08:00:00Z" }),
      q({ id: "x", status: "declined", total: 9 }),
    ], [], [], now);
    expect(columnSummary(deals, "draft")).toEqual({ count: 2, total: 150000, avgDays: 16 });
    expect(followUps(deals).map((d) => d.quote.id)).toEqual(["b", "a"]);
  });

  it("builds attention chips and chip filters", () => {
    const deals = buildDeals([q({ id: "z", total: 0 }), q({ id: "v", status: "viewed", total: 5, viewed_at: "2026-09-01T08:00:00Z" })], [], [], now);
    const chips = pipelineChips(deals, 4);
    expect(chips.map((c) => c.key)).toEqual(["stale_reply", "zero", "not_contacted"]);
    expect(deals.filter((d) => matchesChip(d, "zero")).map((d) => d.quote.id)).toEqual(["z"]);
  });

  it("maps drags to actions, never backwards", () => {
    expect(dropAction("draft", "sent").action).toBe("send");
    expect(dropAction("viewed", "accepted").action).toBe("accept");
    expect(dropAction("accepted", "booked").action).toBe("book");
    expect(dropAction("sent", "booked").action).toBeNull();
    expect(dropAction("sent", "lost").action).toBe("lose");
    expect(dropAction("sent", "draft").action).toBeNull();
    expect(fmtRandShort(287500)).toBe("R287.5k");
  });
});

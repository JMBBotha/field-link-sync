import { describe, it, expect } from "vitest";
import { isUnpaid, unpaidBucket, sortUnpaid } from "@/lib/unpaidBuckets";

describe("one Unpaid rule", () => {
  it("counts every open invoice with a balance, incl. due on completion", () => {
    expect(isUnpaid("sent", 100)).toBe(true);
    expect(isUnpaid("partially_paid", 6412.2)).toBe(true);
    expect(isUnpaid("paid", 10)).toBe(false);
    expect(isUnpaid("draft", 10)).toBe(false);
    expect(isUnpaid("sent", 0)).toBe(false);
  });
  it("buckets: overdue / due soon / due on completion", () => {
    expect(unpaidBucket("partially_paid", { days: 1 })).toBe("overdue");
    expect(unpaidBucket("sent", { days: -3 })).toBe("soon");
    expect(unpaidBucket("sent", { days: 0 })).toBe("soon");
    expect(unpaidBucket("sent", { days: null as any, waiting: true })).toBe("completion");
    expect(unpaidBucket("sent", undefined)).toBe("completion");
  });
  it("sorts overdue, then soon, then completion", () => {
    const rows = [
      { id: "c", status: "sent", due: { days: null as any, waiting: true } },
      { id: "s", status: "sent", due: { days: -2 } },
      { id: "o", status: "partially_paid", due: { days: 1 } },
    ];
    expect(sortUnpaid(rows, (r) => r).map((r) => r.id)).toEqual(["o", "s", "c"]);
  });
});

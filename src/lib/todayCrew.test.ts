import { describe, expect, it } from "vitest";
import { MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID } from "@/lib/adminHomeCount";
import { countsOnJohannesburgDay, johannesburgDayBounds, mergeTodayCrew, type TodayJobRow } from "@/lib/todayCrew";

const CT = MASSAIR_CT_ID;
const DAY = "2026-11-07";

function job(over: Partial<TodayJobRow> & { id: string }): TodayJobRow {
  return { company_id: CT, status: "scheduled", job_type: "installation", title: "Installation", ...over };
}

describe("jobs being done today (Africa/Johannesburg)", () => {
  it("uses a Johannesburg day, not UTC midnight", () => {
    expect(johannesburgDayBounds(DAY)).toEqual({
      start: "2026-11-07T00:00:00+02:00",
      end: "2026-11-08T00:00:00+02:00",
    });
    // 22:30 UTC Friday is 00:30 Saturday in Johannesburg.
    expect(countsOnJohannesburgDay(job({ id: "early", completed_at: "2026-11-06T22:30:00Z", status: "completed" }), DAY)).toBe(true);
    // 22:30 UTC Saturday is 00:30 Sunday in Johannesburg.
    expect(countsOnJohannesburgDay(job({ id: "late", completed_at: "2026-11-07T22:30:00Z", status: "completed" }), DAY)).toBe(false);
  });

  it("keeps a job completed today even when it was booked on another day", () => {
    const cards = mergeTodayCrew({
      companyId: CT,
      day: DAY,
      schedule: [],
      jobs: [job({
        id: "done",
        status: "completed",
        scheduled_for: "2026-11-03T13:00:00Z",
        completed_at: "2026-11-07T08:00:00+02:00",
        customer_name: "Finished client",
        assignee: "Tech A",
      })],
    });
    expect(cards.map((c) => c.id)).toEqual(["done"]);
    expect(cards[0].href).toBe("/admin/jobs/done");
    expect(cards[0].who).toBe("Tech A");
  });

  it("counts a job booked or on site today", () => {
    const cards = mergeTodayCrew({
      companyId: CT,
      day: DAY,
      schedule: [{ jobId: "booked", who: "Innocent", where: "12 Demo Road, Claremont", client: "Demo Client" }],
      jobs: [
        job({ id: "booked", scheduled_for: "2026-11-03T09:00:00Z", title: "Booked earlier, visiting today" }),
        job({ id: "site", status: "in_progress", started_at: "2026-11-07T09:15:00+02:00", customer_name: "On site" }),
      ],
    });
    expect(cards.map((c) => c.id)).toEqual(["booked", "site"]);
    expect(cards[0].who).toBe("Innocent");
  });

  it("leaves Saturday 7 Nov empty when the only rows are earlier this week and still scheduled", () => {
    const week = [
      job({ id: "fe4035ad-0b81-4215-9e35-b5c315826648", title: "Avec Cape Estates House 32", scheduled_for: "2026-11-03T13:00:00Z" }),
      job({ id: "bc23b29f-c050-4d13-a459-d8c7789bb2e8", title: "Avec Cape Estates House 88", scheduled_for: "2026-11-03T09:00:00Z" }),
      job({ id: "af49ca54-bab8-4a36-af74-a93c35d05c7e", title: "Hennie Matthee", scheduled_for: "2026-11-06T07:30:00Z" }),
    ];
    expect(mergeTodayCrew({ companyId: CT, day: DAY, schedule: [], jobs: week })).toEqual([]);
  });

  it("drops cancelled jobs and other companies", () => {
    const cards = mergeTodayCrew({
      companyId: CT,
      day: DAY,
      schedule: [{ jobId: "cancel" }, { jobId: "ind" }],
      jobs: [
        job({ id: "cancel", status: "cancelled", scheduled_for: "2026-11-07T09:00:00+02:00" }),
        job({ id: "ind", company_id: MASSAIR_IND_ID, scheduled_for: "2026-11-07T09:00:00+02:00" }),
        job({ id: "hvac", company_id: TEST_HVAC_ID, completed_at: "2026-11-07T10:00:00+02:00", status: "completed" }),
      ],
    });
    expect(cards).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { assembleScheduleBlocks, bookingAriaLabel, bookingChip, bookingHoverEnabled, bookingIdentity, bookingPopup, bookingRecordHref, clampPopup, sameDaySpan } from "./bookingGlance";
import type { CalendarEntry } from "./todaysJobs";

const glance = {
  client: "Youssin", title: "Installation — 14 Oak Street", jobType: "installation",
  place: "14 Oak Street, Cape Town", assignee: "Innocent Mattienga", assigneeRole: "service" as const,
  status: "scheduled", day: "2099-06-02", start: 9 * 60 + 30, end: 11 * 60 + 30,
};

describe("booking identity", () => {
  it("prefers the client over a generic installation title", () => {
    expect(bookingIdentity("Youssin", "Installation — 14 Oak Street", "installation")).toBe("Youssin");
    const chip = bookingChip(glance, "month");
    expect(chip.time).toBe("09:30");
    expect(chip.identity).toBe("Youssin");
    expect(chip.extra).toBeNull();
    expect(bookingChip(glance, "compact").extra).toContain("Install");
    expect(`${chip.time} ${chip.identity}`).not.toMatch(/Installation/);
  });

  it("uses the distinctive job name when there is no client", () => {
    expect(bookingIdentity(null, "Installation — Avec Cape Estates House 32", "installation")).toBe("Avec Cape Estates House 32");
    expect(bookingIdentity("", "Ric Meiring", null)).toBe("Ric Meiring");
  });

  it("does not invent a client when the only words are the job type", () => {
    expect(bookingIdentity(null, "Installation", "installation")).toBe("Install");
    expect(bookingIdentity("Installation", "Installation", "installation")).toBe("Install");
    const chip = bookingChip({ ...glance, client: null, title: "Installation", place: null, assignee: null, end: null }, "month");
    expect(chip.identity).toBe("Install");
    expect(chip.extra).toBeNull();
  });
});

describe("booking popup", () => {
  it("lists the booking and leaves unknowns out", () => {
    const pop = bookingPopup(glance);
    expect(pop.heading).toBe("Youssin");
    expect(pop.lines.map((l) => l.label)).toEqual(["Type", "When", "Technician", "Location", "Status"]);
    expect(pop.lines.find((l) => l.label === "Type")?.value).toBe("New Installation · 14 Oak Street");
    expect(pop.lines.find((l) => l.label === "When")?.value).toMatch(/09:30–11:30/);
    expect(pop.lines.find((l) => l.label === "Technician")?.value).toBe("Innocent Mattienga");
    expect(pop.lines.find((l) => l.label === "Status")?.value).toBe("Scheduled");
    const thin = bookingPopup({ day: "2099-06-02", start: 8 * 60, title: "Installation", jobType: "installation" });
    expect(thin.lines.map((l) => l.label)).toEqual(["Type", "When"]);
    expect(thin.lines.find((l) => l.label === "When")?.value).toMatch(/08:00$/);
    expect(thin.lines.find((l) => l.label === "When")?.value).not.toMatch(/–/);
  });

  it("names a sales visit's person as the rep and shows a multi-day badge", () => {
    const pop = bookingPopup({
      client: "Youssin", title: "Sales visit", serviceType: "Sales/Consultation", assignee: "Johan Botha",
      assigneeRole: "sales", status: "pending", day: "2099-06-03", start: 14 * 60, end: 15 * 60,
      dayIndex: 2, dayCount: 3, place: "Sea Point",
    });
    expect(pop.lines.find((l) => l.label === "Rep")?.value).toBe("Johan Botha");
    expect(pop.lines.find((l) => l.label === "When")?.value).toMatch(/Day 2\/3/);
    expect(bookingChip({ ...glance, dayIndex: 2, dayCount: 3 }, "compact").extra).toMatch(/Day 2\/3/);
    expect(bookingChip({ ...glance, dayIndex: 2, dayCount: 3 }, "month").extra).toBe("2/3");
  });

  it("puts the same facts on the accessible name so hover is not required", () => {
    expect(bookingAriaLabel(glance)).toContain("Youssin");
    expect(bookingAriaLabel(glance)).toContain("Innocent Mattienga");
    expect(bookingAriaLabel(glance)).toContain("14 Oak Street, Cape Town");
    expect(bookingAriaLabel(glance)).toContain("Opens this booking");
  });
});

describe("booking routes", () => {
  it("opens the job when there is a job, otherwise the booking, otherwise nowhere", () => {
    expect(bookingRecordHref("job-1", "lead-1")).toBe("/admin/jobs/job-1");
    expect(bookingRecordHref(null, "lead-1")).toBe("/admin/bookings/lead-1");
    expect(bookingRecordHref(null, null)).toBeNull();
    expect(bookingRecordHref("job-1", null)).not.toMatch(/dispatch/);
    expect(bookingRecordHref(null, "lead-1")).not.toMatch(/dispatch/);
  });
});

describe("hover versus touch", () => {
  it("keeps the hover card off touch pointers", () => {
    expect(bookingHoverEnabled("mouse")).toBe(true);
    expect(bookingHoverEnabled("pen")).toBe(true);
    expect(bookingHoverEnabled("touch")).toBe(false);
    expect(bookingHoverEnabled(undefined)).toBe(true);
  });
});

describe("popup stays in the viewport", () => {
  it("flips above a chip on the bottom edge and clamps the right edge", () => {
    const low = clampPopup({ top: 700, bottom: 740, left: 20 }, { width: 800, height: 760 }, { width: 260, height: 180 });
    expect(low.top).toBeLessThan(700);
    expect(low.top).toBeGreaterThanOrEqual(8);
    const right = clampPopup({ top: 40, bottom: 70, left: 700 }, { width: 800, height: 760 }, { width: 260, height: 120 });
    expect(right.left + 260).toBeLessThanOrEqual(800 - 8);
    expect(right.top).toBeGreaterThan(70);
  });
});

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1", title: "Installation — 14 Oak Street", status: "scheduled", job_type: "installation",
  scheduled_for: "2099-06-02T09:30:00+02:00", address: "14 Oak Street, Cape Town",
  customers: { name: "Youssin" },
  assignments: [{ profile_id: "tech-1", status: "assigned", profiles: { full_name: "Innocent Mattienga" } }],
  ...over,
});

const entry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  key: "lead:lead-1", date: "2099-06-03", start_time: "14:00:00", lead_id: "lead-1", job_id: null,
  agent_id: "rep-1", status: "pending", customer_name: "Youssin", customer_address: "Sea Point",
  service_type: "Sales/Consultation", ...over,
});

describe("assembleScheduleBlocks", () => {
  it("routes a job to the job and a visit to the booking, with the client on the block", () => {
    const { blocks, people } = assembleScheduleBlocks({
      jobs: [job(), job({ id: "job-sales", job_type: "quote", title: "Quote", customers: { name: "Amina" }, assignments: [{ profile_id: "rep-1", status: "assigned", profiles: { full_name: "Johan Botha" } }], scheduled_for: "2099-06-02T11:00:00+02:00" })],
      entries: [entry()],
      names: { "rep-1": { full_name: "Johan Botha" } },
      today: "2099-06-02",
    });
    const youssin = blocks.find((b) => b.id === "job-1")!;
    expect(youssin.href).toBe("/admin/jobs/job-1");
    expect(youssin.client).toBe("Youssin");
    expect(youssin.kind).toBe("job");
    expect(youssin.draggable).toBe(true);
    expect(youssin.dur).toBe(120);
    expect(youssin.end).toBeNull();
    const visit = blocks.find((b) => b.kind === "visit")!;
    expect(visit.href).toBe("/admin/bookings/lead-1");
    expect(visit.id).toBe("v-lead:lead-1");
    expect(visit.client).toBe("Youssin");
    expect(visit.assigneeRole).toBe("sales");
    expect(visit.draggable).toBe(false);
    expect(visit.href).not.toMatch(/dispatch/);
    expect(people.map((p) => p.role)).toEqual(["Tech", "Sales"]);
    expect(people.find((p) => p.id === "tech-1")?.dot).toBe("blue");
  });

  it("uses a stored same-day length and does not invent one", () => {
    const known = assembleScheduleBlocks({
      jobs: [job({ estimated_duration: "01:30:00" })], entries: [], names: {}, today: "2099-06-02",
    }).blocks[0];
    expect(known.dur).toBe(90);
    expect(known.end).toBe(9 * 60 + 30 + 90);
    const until = assembleScheduleBlocks({
      jobs: [job({ scheduled_until: "2099-06-02T11:00:00+02:00" })], entries: [], names: {}, today: "2099-06-02",
    }).blocks[0];
    expect(until.end).toBe(11 * 60);
    const nextDay = assembleScheduleBlocks({
      jobs: [job({ scheduled_until: "2099-06-04T11:00:00+02:00", estimated_duration: "2 days" })], entries: [], names: {}, today: "2099-06-02",
    }).blocks[0];
    expect(nextDay.end).toBeNull();
    expect(nextDay.dur).toBe(120);
    expect(sameDaySpan("2099-06-02T09:30:00+02:00", null, null)).toEqual({ end: null, minutes: null });
  });

  it("shows each day of a multi-day run once and opens the same job", () => {
    const days = [1, 2, 3].map((i) => entry({
      key: `job:job-1:2099-06-0${i + 1}`, date: `2099-06-0${i + 1}`, job_id: "job-1", lead_id: "lead-9",
      day_index: i, day_count: 3, start_time: "08:00:00", customer_name: "Youssin", service_type: "Installation",
      agent_id: "tech-1", status: "scheduled",
    }));
    const { blocks } = assembleScheduleBlocks({ jobs: [job()], entries: days, names: { "tech-1": { full_name: "Innocent Mattienga" } }, today: "2099-06-02" });
    const rows = blocks.filter((b) => b.id === "job-1");
    expect(rows.map((b) => b.day)).toEqual(["2099-06-02", "2099-06-03", "2099-06-04"]);
    expect(new Set(rows.map((b) => b.uid)).size).toBe(3);
    expect(rows.map((b) => b.href)).toEqual(["/admin/jobs/job-1", "/admin/jobs/job-1", "/admin/jobs/job-1"]);
    expect(rows.map((b) => b.draggable)).toEqual([true, false, false]);
    expect(rows.map((b) => b.dayIndex)).toEqual([1, 2, 3]);
    expect(rows.every((b) => b.dayCount === 3)).toBe(true);
  });

  it("drops cancelled jobs and visits with no client name", () => {
    const { blocks } = assembleScheduleBlocks({
      jobs: [job(), job({ id: "gone", status: "cancelled" })],
      entries: [entry({ key: "lead:blank", lead_id: "blank", customer_name: "  ", job_id: null })],
      names: {}, today: "2099-06-02",
    });
    expect(blocks.map((b) => b.id)).toEqual(["job-1"]);
  });

  it("marks the tech on site when a job is in progress today", () => {
    const { people } = assembleScheduleBlocks({
      jobs: [job({ status: "in_progress", scheduled_for: "2099-06-02T09:30:00+02:00" })],
      entries: [], names: {}, today: "2099-06-02",
    });
    expect(people[0].dot).toBe("green");
  });
});
